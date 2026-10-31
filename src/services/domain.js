import mongoose from 'mongoose';
import QRCode from 'qrcode';
import { AppError, encryptToken, hashToken, money, token } from '../utils/core.js';
import { Bill, MenuItem, Order, Payment, Reservation, RestaurantSettings, Table, TableSession, WaiterCall } from '../models/index.js';

export const issueTableQr = async table => {
  const raw = token(32); table.qrTokenHash = hashToken(raw); table.qrTokenEncrypted = encryptToken(raw); table.qrTokenHint = raw.slice(-6); table.qrVersion += 1; await table.save(); return raw;
};
export const qrData = async (table, raw, frontendUrl, type = 'png') => {
  const url = `${frontendUrl}/table/${encodeURIComponent(raw)}`;
  return type === 'svg' ? QRCode.toString(url, { type: 'svg', margin: 1 }) : QRCode.toDataURL(url, { width: 800, margin: 2 });
};
export const openTableSession = async ({ qrToken, guestId, guestCount, autoActivate, minutes }) => {
  const table = await Table.findOne({ qrTokenHash: hashToken(qrToken) }).select('+qrTokenHash');
  if (!table?.active || table.state === 'disabled') throw new AppError(404, 'QR code is invalid or revoked', 'INVALID_QR');
  const active = await TableSession.findOne({ table: table.id, status: 'active', expiresAt: { $gt: new Date() } });
  if (active) { if (!active.guestIds.includes(guestId)) active.guestIds.push(guestId); await active.save(); return { table, session: active, joined: true }; }
  const rawSession = token(36);
  const session = await TableSession.create({ table: table.id, tokenHash: rawSession, status: autoActivate ? 'active' : 'pending', guestCount, guestIds: [guestId], expiresAt: new Date(Date.now() + minutes * 60000) });
  if (autoActivate) { table.state = 'occupied'; await table.save(); }
  return { table, session, rawSession, joined: false };
};

export const calculateOrder = async (session, payload) => {
  const ids = payload.items.map(i => i.menuItemId);
  const items = await MenuItem.find({ _id: { $in: ids }, visible: true, available: true, soldOut: false });
  const map = new Map(items.map(i => [i.id, i]));
  const snapshots = payload.items.map(input => {
    const item = map.get(input.menuItemId); if (!item) throw new AppError(409, 'One or more items are unavailable', 'ITEM_UNAVAILABLE');
    const variant = input.variantId ? item.variants.id(input.variantId) : null; if (input.variantId && !variant?.available) throw new AppError(409, 'Selected variant is unavailable');
    const extras = (input.extraIds || []).map(extraId => { const extra = item.extras.id(extraId); if (!extra?.available) throw new AppError(409, 'Selected extra is unavailable'); return { name: extra.name, priceDelta: extra.priceDelta }; });
    const discountedBase = Math.round(item.basePrice * (10000 - item.discountBps) / 10000);
    const unitPrice = discountedBase + (variant?.priceDelta || 0) + money(extras.map(e => e.priceDelta));
    return { menuItemId: item.id, name: item.name, quantity: input.quantity, basePrice: item.basePrice, prepMinutes: item.prepMinutes, variant: variant && { name: variant.name, priceDelta: variant.priceDelta }, extras, unitPrice, lineTotal: unitPrice * input.quantity, notes: input.notes };
  });
  const settings = await RestaurantSettings.findOne({ singletonKey: 'primary' });
  const subtotal = money(snapshots.map(i => i.lineTotal)); const tax = Math.round(subtotal * (settings?.taxRateBps || 0) / 10000); const serviceCharge = Math.round(subtotal * (settings?.serviceRateBps || 0) / 10000);
  return { snapshots, subtotal, tax, serviceCharge, total: subtotal + tax + serviceCharge };
};
export const createOrder = async (session, payload, key) => {
  const existing = await Order.findOne({ tableSession: session.id, idempotencyKey: key }); if (existing) return { order: existing, duplicate: true };
  const pricing = await calculateOrder(session, payload);
  try {
    const count = await Order.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) } });
    const order = await Order.create({ orderNumber: `O-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(count + 1).padStart(4,'0')}`, tableSession: session.id, table: session.table, guestId: payload.guestId, idempotencyKey: key, items: pricing.snapshots, notes: payload.notes, ...pricing, discount: 0, statusHistory: [{ status: 'pending' }] });
    return { order, duplicate: false };
  } catch (error) { if (error.code === 11000) return { order: await Order.findOne({ tableSession: session.id, idempotencyKey: key }), duplicate: true }; throw error; }
};

export const transitions = { pending: ['accepted','rejected','cancelled'], accepted: ['preparing','cancelled'], preparing: ['ready','cancelled'], ready: ['served'], served: ['completed'], completed: [], rejected: [], cancelled: [] };
export const transitionOrder = async (orderId, status, actor, reason) => {
  const current = await Order.findById(orderId); if (!current) throw new AppError(404, 'Order not found');
  if (!transitions[current.status].includes(status)) throw new AppError(409, `Cannot move order from ${current.status} to ${status}`, 'INVALID_TRANSITION');
  const updated = await Order.findOneAndUpdate({ _id: current.id, status: current.status, version: current.version }, { $set: { status }, $inc: { version: 1 }, $push: { statusHistory: { status, by: actor, reason, at: new Date() } } }, { new: true });
  if (!updated) throw new AppError(409, 'Order changed; refresh and retry', 'STALE_UPDATE'); return updated;
};

export const createWaiterCall = async (session, type) => {
  const since = new Date(Date.now() - 2 * 60000); const recent = await WaiterCall.findOne({ tableSession: session.id, type, status: { $in: ['open','acknowledged'] }, createdAt: { $gte: since } });
  if (recent) throw new AppError(429, 'A similar request is already active', 'CALL_RATE_LIMIT');
  return WaiterCall.create({ tableSession: session.id, table: session.table, type, priority: type === 'urgent' ? 2 : 1, history: [{ status: 'open' }] });
};

export const findAvailableTables = async (date, partySize, durationMinutes = 120) => {
  const end = new Date(date.getTime() + durationMinutes * 60000);
  const candidates = await Table.find({ active: true, capacity: { $gte: partySize }, state: { $ne: 'disabled' } }).sort({ capacity: 1, number: 1 });
  const availability = await Promise.all(candidates.map(async table => {
    const conflict = await Reservation.exists({ table: table.id, status: { $in: ['pending','confirmed','seated'] }, date: { $lt: end }, $expr: { $gt: [{ $add: ['$date', { $multiply: ['$durationMinutes', 60000] }] }, date] } });
    return conflict ? null : table;
  }));
  return availability.filter(Boolean);
};

export const createReservation = async payload => {
  const settings = await RestaurantSettings.findOne({ singletonKey: 'primary' }); const rules = settings?.reservationRules || { leadMinutes: 60, durationMinutes: 120, maxPartySize: 20 };
  if (payload.date.getTime() < Date.now() + rules.leadMinutes * 60000) throw new AppError(422, 'Reservation does not meet minimum lead time');
  if (payload.partySize > rules.maxPartySize) throw new AppError(422, 'Party size exceeds online booking limit');
  if (settings?.closures?.some(c => c.date === payload.date.toISOString().slice(0,10))) throw new AppError(409, 'Restaurant is closed on this date');
  const candidates = await findAvailableTables(payload.date, payload.partySize, rules.durationMinutes);
  const table = payload.tableId ? candidates.find(candidate => candidate.id === payload.tableId) : candidates[0];
  if (table) { const { tableId: _tableId, ...reservation } = payload; return Reservation.create({ ...reservation, durationMinutes: rules.durationMinutes, table: table.id }); }
  if (payload.tableId) throw new AppError(409, 'The selected table is no longer available. Please choose another table.', 'TABLE_UNAVAILABLE');
  throw new AppError(409, 'No table is available for this time and party size', 'RESERVATION_CONFLICT');
};

export const createBill = async (sessionId, actor) => {
  const orders = await Order.find({ tableSession: sessionId, status: { $in: ['served','completed'] } }); if (!orders.length) throw new AppError(409, 'No served orders are available to bill');
  const existing = await Bill.findOne({ tableSession: sessionId, status: { $in: ['open','partial','settled'] } }); if (existing) return existing;
  const totals = ['subtotal','discount','tax','serviceCharge','total'].reduce((acc, key) => ({ ...acc, [key]: money(orders.map(o => o[key] || 0)) }), {});
  return Bill.create({ billNumber: `B-${Date.now().toString(36).toUpperCase()}`, tableSession: sessionId, orders: orders.map(o => o.id), ...totals, createdBy: actor });
};
export const recordPayment = async (billId, payload, actor) => {
  const dbSession = await mongoose.startSession(); let result;
  try {
    await dbSession.withTransaction(async () => {
      const bill = await Bill.findById(billId).session(dbSession);
      if (!bill || !['open','partial'].includes(bill.status)) throw new AppError(409, 'Bill cannot accept payment');
      if (!Number.isInteger(payload.amount) || payload.amount <= 0) throw new AppError(422, 'Payment amount must be greater than zero');
      const due = bill.total - bill.paid + bill.refunded;
      if (payload.amount > due) throw new AppError(422, 'Payment exceeds outstanding balance');
      const payment = await Payment.create([{ bill: bill.id, ...payload, recordedBy: actor }], { session: dbSession });
      bill.paid += payload.amount;
      bill.status = bill.paid >= bill.total ? 'settled' : 'partial';
      await bill.save({ session: dbSession });
      let tableSession;
      if (bill.status === 'settled') {
        tableSession = await TableSession.findByIdAndUpdate(bill.tableSession, { $set: { status: 'closed', closedAt: new Date() } }, { new: true, session: dbSession });
        if (tableSession) await Table.findByIdAndUpdate(tableSession.table, { $set: { state: 'cleaning' } }, { session: dbSession });
      }
      result = { bill, payment: payment[0], tableSession };
    });
    return result;
  } finally {
    await dbSession.endSession();
  }
};

