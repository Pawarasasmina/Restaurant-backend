import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { AuditLog, Bill, MenuCategory, MenuItem, Order, Reservation, RestaurantSettings, Table, TableSession, User, WaiterCall } from '../models/index.js';
import { allow, auth, guestSession, validate } from '../middleware/index.js';
import { asyncHandler, AppError, decryptToken, encryptToken, hashToken, ok, signAccess, signRefresh, token } from '../utils/core.js';
import { callSchema, categorySchema, itemSchema, loginSchema, orderSchema, reservationSchema, sessionSchema, settingsSchema, setupSchema, tableSchema } from '../validators/index.js';
import { createBill, createOrder, createReservation, createWaiterCall, findAvailableTables, issueTableQr, openTableSession, qrData, recordPayment, transitionOrder } from '../services/domain.js';

const router = Router();
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype);
    callback(allowed ? null : new AppError(422,'Only JPG, PNG, WebP, and GIF images are allowed'), allowed);
  },
});
const audit = (req, action, entity, after) => AuditLog.create({ actor: req.user?.id, action, entityType: entity?.constructor?.modelName, entityId: entity?.id, after, ip: req.ip, userAgent: req.get('user-agent') }).catch(() => {});
const authCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
};
const cookies = res => ({
  set(access, refresh) {
    res.cookie('accessToken', access, { ...authCookieOptions, maxAge: 15 * 60000 });
    res.cookie('refreshToken', refresh, { ...authCookieOptions, maxAge: 7 * 86400000 });
  },
  clear() {
    res.clearCookie('accessToken', authCookieOptions);
    res.clearCookie('refreshToken', authCookieOptions);
  },
});

router.get('/health', (_req, res) => ok(res, { status: 'ok', timestamp: new Date().toISOString() }));
router.post('/auth/setup', validate(setupSchema), asyncHandler(async (req, res) => { if (await User.exists({ role: 'owner' })) throw new AppError(409, 'Owner setup is already complete'); const user = await User.create({ ...req.validated.body, passwordHash: await bcrypt.hash(req.validated.body.password, 12), role: 'owner' }); ok(res, { id: user.id, email: user.email, role: user.role }, 201); }));
router.post('/auth/login', rateLimit({ windowMs: 15*60000, limit: 10 }), validate(loginSchema), asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.validated.body.email.toLowerCase() }).select('+passwordHash');
  if (!user || user.lockedUntil > new Date() || !await bcrypt.compare(req.validated.body.password, user.passwordHash)) { if (user) { user.failedLogins += 1; if (user.failedLogins >= 5) user.lockedUntil = new Date(Date.now()+15*60000); await user.save(); } throw new AppError(401, 'Invalid email or password'); }
  const refreshId = token(16), refresh = signRefresh(user, refreshId); user.failedLogins = 0; user.lockedUntil = undefined; user.lastLoginAt = new Date(); user.refreshTokenHashes.push({ hash: hashToken(refreshId), expiresAt: new Date(Date.now()+7*86400000) }); await user.save(); cookies(res).set(signAccess(user), refresh); ok(res, { user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));
router.post('/auth/refresh', asyncHandler(async (req, res) => { const raw = req.cookies.refreshToken; if (!raw) throw new AppError(401, 'Refresh token required'); const payload = jwt.verify(raw, env.JWT_REFRESH_SECRET); const user = await User.findOne({ _id: payload.sub, 'refreshTokenHashes.hash': hashToken(payload.jti), active: true }); if (!user) throw new AppError(401, 'Refresh session invalid'); cookies(res).set(signAccess(user), raw); ok(res, { refreshed: true }); }));
router.post('/auth/logout', asyncHandler(async (req, res) => { cookies(res).clear(); ok(res, { loggedOut: true }); }));
router.get('/auth/me', auth, (req, res) => ok(res, { user: req.user }));

router.get('/public/settings', asyncHandler(async (_req, res) => ok(res, await RestaurantSettings.findOne({ singletonKey: 'primary' }))));
router.get('/public/media/:id',asyncHandler(async(req,res)=>{
  if(!mongoose.isValidObjectId(req.params.id))throw new AppError(404,'Image not found');
  const bucket=new mongoose.mongo.GridFSBucket(mongoose.connection.db,{bucketName:'websiteImages'});
  const files=await bucket.find({_id:new mongoose.Types.ObjectId(req.params.id)}).limit(1).toArray();
  if(!files.length)throw new AppError(404,'Image not found');
  res.set({ 'Content-Type': files[0].metadata?.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  bucket.openDownloadStream(files[0]._id).on('error',()=>res.destroy()).pipe(res);
}));
router.get('/public/menu', asyncHandler(async (req, res) => { const query = { visible: true }; if (req.query.category) query.category = req.query.category; if (req.query.featured === 'true') query.featured = true; if (req.query.search) query.$text = { $search: req.query.search }; const page = Math.max(1, Number(req.query.page)||1), limit = Math.min(50, Math.max(1, Number(req.query.limit)||24)); const [items,total,categories] = await Promise.all([MenuItem.find(query).populate('category').sort({ order:1,name:1 }).skip((page-1)*limit).limit(limit),MenuItem.countDocuments(query),MenuCategory.find({ visible:true }).sort({order:1}),]); ok(res,{items,categories},200,{page,limit,total,pages:Math.ceil(total/limit)}); }));
router.post('/public/reservations', rateLimit({ windowMs: 60000, limit: 5 }), validate(reservationSchema), asyncHandler(async (req,res)=>ok(res,await createReservation(req.validated.body),201)));
router.get('/public/reservations/available-tables',asyncHandler(async(req,res)=>{
  const date=new Date(String(req.query.date||'')),partySize=Number(req.query.partySize);
  if(Number.isNaN(date.getTime())||!Number.isInteger(partySize)||partySize<1||partySize>30)throw new AppError(422,'Choose a valid date, time, and party size');
  const settings=await RestaurantSettings.findOne({singletonKey:'primary'});
  const rules=settings?.reservationRules||{leadMinutes:60,durationMinutes:120,maxPartySize:20};
  if(date.getTime()<Date.now()+rules.leadMinutes*60000)throw new AppError(422,'Please choose a later reservation time');
  if(partySize>rules.maxPartySize)throw new AppError(422,'Party size exceeds the online booking limit');
  if(settings?.closures?.some(closure=>closure.date===date.toISOString().slice(0,10)))throw new AppError(409,'The restaurant is closed on this date');
  const tables=await findAvailableTables(date,partySize,rules.durationMinutes);
  ok(res,tables.map(table=>({id:table.id,number:table.number,displayName:table.displayName,capacity:table.capacity,zone:table.zone})));
}));
router.post('/table-sessions', rateLimit({ windowMs: 60000, limit: 10 }), validate(sessionSchema), asyncHandler(async(req,res)=>{ const result=await openTableSession({...req.validated.body,autoActivate:env.DEMO_AUTO_ACTIVATE_TABLES,minutes:env.TABLE_SESSION_MINUTES}); if(result.rawSession) res.cookie('tableSession',result.rawSession,{...authCookieOptions,maxAge:env.TABLE_SESSION_MINUTES*60000}); ok(res,{table:{id:result.table.id,number:result.table.number,displayName:result.table.displayName},session:{id:result.session.id,status:result.session.status,expiresAt:result.session.expiresAt},joined:result.joined},201); }));
router.get('/guest/session',guestSession,asyncHandler(async(req,res)=>ok(res,{session:req.tableSession,table:await Table.findById(req.tableSession.table)})));
router.get('/guest/orders',guestSession,asyncHandler(async(req,res)=>ok(res,await Order.find({tableSession:req.tableSession.id}).sort({createdAt:-1}))));
router.post('/guest/orders',guestSession,validate(orderSchema),asyncHandler(async(req,res)=>{const key=req.get('idempotency-key');if(!key||key.length<12)throw new AppError(400,'A valid Idempotency-Key header is required');const result=await createOrder(req.tableSession,req.validated.body,key);req.app.get('io').to('staff:orders').emit('order:new',result.order);req.app.get('io').to(`table:${req.tableSession.id}`).emit('order:changed',result.order);ok(res,result.order,result.duplicate?200:201);}));
router.post('/guest/waiter-calls',guestSession,validate(callSchema),asyncHandler(async(req,res)=>{const call=await createWaiterCall(req.tableSession,req.validated.body.type);req.app.get('io').to('staff:calls').emit('waiter-call:new',call);ok(res,call,201);}));

router.use(auth);
router.post('/uploads/images',allow('owner','manager'),imageUpload.single('image'),asyncHandler(async(req,res)=>{
  if(!req.file)throw new AppError(422,'Choose an image up to 5 MB');
  const bucket=new mongoose.mongo.GridFSBucket(mongoose.connection.db,{bucketName:'websiteImages'});
  const fileId=new mongoose.Types.ObjectId();
  await new Promise((resolve,reject)=>{const stream=bucket.openUploadStreamWithId(fileId,`${Date.now()}-${req.file.originalname.replace(/[^a-z0-9._-]/gi,'-')}`,{metadata:{contentType:req.file.mimetype,uploadedBy:req.user.id}});stream.on('error',reject);stream.on('finish',resolve);stream.end(req.file.buffer);});
  const url=`/api/v1/public/media/${fileId}`;
  ok(res,{url,id:fileId},201);
}));
router.get('/settings',(_req,res,next)=>RestaurantSettings.findOne({singletonKey:'primary'}).then(x=>ok(res,x)).catch(next));
router.put('/settings',allow('owner','manager'),validate(settingsSchema),asyncHandler(async(req,res)=>{const value=await RestaurantSettings.findOneAndUpdate({singletonKey:'primary'},{$set:req.validated.body},{new:true,upsert:true,runValidators:true});audit(req,'settings.update',value,req.validated.body);ok(res,value);}));

const crud = (path, Model, schema, roles=['owner','manager']) => {
  router.get(path,asyncHandler(async(req,res)=>{const page=Math.max(1,+req.query.page||1),limit=Math.min(100,+req.query.limit||30);const query=req.query.search?{$text:{$search:req.query.search}}:{};const [items,total]=await Promise.all([Model.find(query).sort({createdAt:-1}).skip((page-1)*limit).limit(limit),Model.countDocuments(query)]);ok(res,items,200,{page,limit,total});}));
  router.post(path,allow(...roles),validate(schema),asyncHandler(async(req,res)=>{const value=await Model.create({...req.validated.body,createdBy:req.user.id});audit(req,`${Model.modelName}.create`,value,value);ok(res,value,201);}));
  router.patch(`${path}/:id`,allow(...roles),asyncHandler(async(req,res)=>{const value=await Model.findByIdAndUpdate(req.params.id,{$set:{...req.body,updatedBy:req.user.id}},{new:true,runValidators:true});if(!value)throw new AppError(404,'Record not found');audit(req,`${Model.modelName}.update`,value,req.body);ok(res,value);}));
  router.delete(`${path}/:id`,allow(...roles),asyncHandler(async(req,res)=>{const value=await Model.findByIdAndDelete(req.params.id);if(!value)throw new AppError(404,'Record not found');audit(req,`${Model.modelName}.delete`,value);ok(res,{deleted:true});}));
};
router.patch('/menu-items/bulk/availability',allow('owner','manager','chef'),asyncHandler(async(req,res)=>{const result=await MenuItem.updateMany({_id:{$in:req.body.ids}},{$set:{available:Boolean(req.body.available)}});ok(res,{updated:result.modifiedCount});}));
crud('/categories',MenuCategory,categorySchema); crud('/menu-items',MenuItem,itemSchema); 

router.get('/tables',asyncHandler(async(_req,res)=>ok(res,await Table.find().sort({zone:1,number:1}))));
router.post('/tables',allow('owner','manager'),validate(tableSchema),asyncHandler(async(req,res)=>{const raw=token(32);const table=await Table.create({...req.validated.body,qrTokenHash:hashToken(raw),qrTokenEncrypted:encryptToken(raw),qrTokenHint:raw.slice(-6),createdBy:req.user.id});ok(res,{table,qrToken:raw,qrUrl:`${env.FRONTEND_URL}/table/${raw}`},201);}));
router.patch('/tables/:id',allow('owner','manager'),asyncHandler(async(req,res)=>ok(res,await Table.findByIdAndUpdate(req.params.id,{$set:req.body},{new:true,runValidators:true}))));
router.delete('/tables/:id',allow('owner','manager'),asyncHandler(async(req,res)=>{if(await TableSession.exists({table:req.params.id,status:{$in:['pending','active']}}))throw new AppError(409,'Cannot delete a table with an active session');await Table.findByIdAndDelete(req.params.id);ok(res,{deleted:true});}));
router.post('/tables/:id/qr/regenerate',allow('owner','manager'),asyncHandler(async(req,res)=>{const table=await Table.findById(req.params.id).select('+qrTokenHash');if(!table)throw new AppError(404,'Table not found');const raw=await issueTableQr(table);await TableSession.updateMany({table:table.id,status:{$in:['pending','active']}},{$set:{status:'expired'}});ok(res,{qrToken:raw,qrUrl:`${env.FRONTEND_URL}/table/${raw}`});}));
router.get('/tables/:id/qr',allow('owner','manager'),asyncHandler(async(req,res)=>{const table=await Table.findById(req.params.id).select('+qrTokenEncrypted');if(!table)throw new AppError(404,'Table not found');if(!table.qrTokenEncrypted)throw new AppError(409,'This older table QR cannot be previewed. Change QR once to enable preview and download.','QR_REGENERATION_REQUIRED');const raw=decryptToken(table.qrTokenEncrypted);ok(res,{data:await qrData(table,raw,env.FRONTEND_URL,req.query.type==='svg'?'svg':'png'),qrUrl:`${env.FRONTEND_URL}/table/${raw}`,type:req.query.type==='svg'?'svg':'png'});}));
router.post('/tables/:id/qr/render',allow('owner','manager'),asyncHandler(async(req,res)=>{const table=await Table.findById(req.params.id);ok(res,{data:await qrData(table,req.body.qrToken,env.FRONTEND_URL,req.body.type)});}));
router.post('/table-sessions/:id/activate',allow('owner','manager','waiter'),asyncHandler(async(req,res)=>{const session=await TableSession.findByIdAndUpdate(req.params.id,{$set:{status:'active',activatedBy:req.user.id}},{new:true});await Table.findByIdAndUpdate(session.table,{$set:{state:'occupied'}});ok(res,session);}));
router.post('/table-sessions/:id/close',allow('owner','manager','cashier'),asyncHandler(async(req,res)=>{const bill=await Bill.findOne({tableSession:req.params.id});if(bill&&bill.status!=='settled')throw new AppError(409,'Bill must be settled before closing');const session=await TableSession.findByIdAndUpdate(req.params.id,{$set:{status:'closed',closedAt:new Date()}},{new:true});await Table.findByIdAndUpdate(session.table,{$set:{state:'cleaning'}});ok(res,session);}));

router.get('/orders',asyncHandler(async(req,res)=>ok(res,await Order.find(req.query.status?{status:req.query.status}:{}).populate('table').sort({createdAt:-1}).limit(200))));
router.patch('/orders/:id/status',allow('owner','manager','cashier','waiter','chef'),asyncHandler(async(req,res)=>{const roleTargets={chef:['preparing','ready'],waiter:['served'],cashier:['completed','rejected','cancelled'],manager:['accepted','rejected','cancelled','preparing','ready','served','completed'],owner:['accepted','rejected','cancelled','preparing','ready','served','completed']};if(!roleTargets[req.user.role].includes(req.body.status))throw new AppError(403,'Role cannot set this status');const order=await transitionOrder(req.params.id,req.body.status,req.user.id,req.body.reason);req.app.get('io').to(`table:${order.tableSession}`).emit('order:changed',order);req.app.get('io').to('staff:orders').emit('order:changed',order);ok(res,order);}));
router.get('/waiter-calls',allow('owner','manager','waiter','cashier'),asyncHandler(async(_req,res)=>ok(res,await WaiterCall.find({status:{$in:['open','acknowledged']}}).populate('table').sort({priority:-1,createdAt:1}))));
router.patch('/waiter-calls/:id',allow('owner','manager','waiter'),asyncHandler(async(req,res)=>{const call=await WaiterCall.findByIdAndUpdate(req.params.id,{$set:{status:req.body.status,assignedTo:req.body.assignedTo},$push:{history:{status:req.body.status,by:req.user.id}}},{new:true});ok(res,call);}));
router.get('/reservations',asyncHandler(async(req,res)=>ok(res,await Reservation.find(req.query.status?{status:req.query.status}:{}).populate('table').sort({date:1}))));
router.post('/reservations',allow('owner','manager','waiter'),validate(reservationSchema),asyncHandler(async(req,res)=>ok(res,await createReservation({...req.validated.body,source:'staff'}),201)));
router.patch('/reservations/:id',allow('owner','manager','waiter'),asyncHandler(async(req,res)=>ok(res,await Reservation.findByIdAndUpdate(req.params.id,{$set:req.body},{new:true,runValidators:true}))));
router.get('/bills',allow('owner','manager','cashier'),asyncHandler(async(req,res)=>{const query=req.query.status?{status:req.query.status}:{};ok(res,await Bill.find(query).sort({createdAt:-1}).limit(300));}));
router.post('/bills',allow('owner','manager','cashier'),asyncHandler(async(req,res)=>ok(res,await createBill(req.body.tableSessionId,req.user.id),201)));
router.post('/bills/:id/payments',allow('owner','manager','cashier'),asyncHandler(async(req,res)=>{
  if (!['cash','card_external','manual'].includes(req.body.method)) throw new AppError(422,'A valid payment method is required');
  const result=await recordPayment(req.params.id,req.body,req.user.id);
  if(result.bill.status==='settled'){
    const io=req.app.get('io');
    io.to(`table:${result.bill.tableSession}`).emit('bill:settled',{billId:result.bill.id});
    io.to(`table:${result.bill.tableSession}`).emit('session:closed',{reason:'paid'});
    io.to('staff:orders').emit('table:closed',{tableSessionId:result.bill.tableSession});
  }
  ok(res,result,201);
}));
router.get('/analytics',allow('owner','manager','cashier'),asyncHandler(async(req,res)=>{const from=req.query.from?new Date(req.query.from):new Date(Date.now()-30*86400000),to=req.query.to?new Date(req.query.to):new Date();const [bills,orders,reservations,calls]=await Promise.all([Bill.find({status:'settled',createdAt:{$gte:from,$lte:to}}),Order.find({createdAt:{$gte:from,$lte:to}}),Reservation.find({createdAt:{$gte:from,$lte:to}}),WaiterCall.find({createdAt:{$gte:from,$lte:to}})]);const revenue=bills.reduce((a,b)=>a+b.total-b.refunded,0);ok(res,{revenue,orderVolume:orders.length,averageOrderValue:orders.length?Math.round(orders.reduce((a,o)=>a+o.total,0)/orders.length):0,reservations:{total:reservations.length,cancelled:reservations.filter(r=>r.status==='cancelled').length},waiterCalls:{total:calls.length,resolved:calls.filter(c=>c.status==='resolved').length}});}));
router.get('/staff',allow('owner','manager'),asyncHandler(async(_req,res)=>ok(res,await User.find().select('-passwordHash -refreshTokenHashes'))));
router.post('/staff',allow('owner','manager'),asyncHandler(async(req,res)=>{if(req.user.role==='manager'&&['owner','manager'].includes(req.body.role))throw new AppError(403,'Managers cannot create elevated accounts');const password=req.body.password||token(16);const user=await User.create({...req.body,passwordHash:await bcrypt.hash(password,12)});ok(res,{user:{id:user.id,name:user.name,email:user.email,role:user.role},temporaryPassword:req.body.password?undefined:password},201);}));
router.patch('/staff/:id',allow('owner','manager'),asyncHandler(async(req,res)=>{if(req.user.role==='manager'&&['owner','manager'].includes(req.body.role))throw new AppError(403,'Managers cannot assign elevated roles');const changes={...req.body};if(changes.password){changes.passwordHash=await bcrypt.hash(changes.password,12);delete changes.password;}delete changes.email;if(String(req.user.id)===req.params.id&&changes.active===false)throw new AppError(409,'You cannot deactivate your own account');const user=await User.findByIdAndUpdate(req.params.id,{$set:changes},{new:true,runValidators:true}).select('-passwordHash -refreshTokenHashes');if(!user)throw new AppError(404,'Staff member not found');audit(req,'User.update',user,changes);ok(res,user);}));
router.get('/audit-logs',allow('owner','manager'),asyncHandler(async(_req,res)=>ok(res,await AuditLog.find().populate('actor','name email').sort({createdAt:-1}).limit(200))));

export default router;

