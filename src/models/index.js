import mongoose from 'mongoose';
const { Schema, model, models } = mongoose;

const auditFields = { createdBy: { type: Schema.Types.ObjectId, ref: 'User' }, updatedBy: { type: Schema.Types.ObjectId, ref: 'User' } };
const money = { type: Number, integer: true, min: 0, default: 0 };

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 }, email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false }, role: { type: String, enum: ['owner','manager','cashier','waiter','chef'], required: true },
  active: { type: Boolean, default: true }, failedLogins: { type: Number, default: 0 }, lockedUntil: Date, refreshTokenHashes: [{ hash: String, expiresAt: Date }], lastLoginAt: Date
}, { timestamps: true });

const settingsSchema = new Schema({
  singletonKey: { type: String, default: 'primary', unique: true }, name: { type: String, required: true, default: 'Saffron & Stone' }, description: String,
  logoUrl: String, heroImageUrl: String, brandColor: { type: String, default: '#8c3b2a' }, phone: String, email: String, address: String, mapUrl: String,
  socialLinks: { instagram: String, facebook: String, tiktok: String }, timezone: { type: String, default: 'Asia/Colombo' }, currency: { type: String, default: 'LKR' },
  openingHours: [{ day: { type: Number, min: 0, max: 6 }, open: String, close: String, closed: Boolean }], closures: [{ date: String, reason: String }],
  taxRateBps: { type: Number, min: 0, max: 10000, default: 0 }, serviceRateBps: { type: Number, min: 0, max: 10000, default: 1000 },
  reservationRules: { leadMinutes: { type: Number, default: 60 }, durationMinutes: { type: Number, default: 120 }, maxPartySize: { type: Number, default: 20 } },
  tableSessionMinutes: { type: Number, default: 240 }, testimonials: [{ name: String, quote: String, visible: Boolean }], gallery: [String], notificationPreferences: { sound: { type: Boolean, default: true } }
}, { timestamps: true });

const categorySchema = new Schema({ name: { type: String, required: true, trim: true }, slug: { type: String, required: true, unique: true }, description: String, imageUrl: String, visible: { type: Boolean, default: true }, order: { type: Number, default: 0 }, ...auditFields }, { timestamps: true });
const optionSchema = new Schema({ name: { type: String, required: true }, priceDelta: money, available: { type: Boolean, default: true } }, { _id: true });
const itemSchema = new Schema({
  category: { type: Schema.Types.ObjectId, ref: 'MenuCategory', required: true, index: true }, name: { type: String, required: true, trim: true }, slug: { type: String, required: true, unique: true },
  description: String, imageUrl: String, imagePublicId: String, basePrice: { ...money, required: true }, discountBps: { type: Number, min: 0, max: 10000, default: 0 },
  ingredients: [String], allergens: [String], dietaryLabels: [String], prepMinutes: { type: Number, min: 0, default: 15 }, variants: [optionSchema], extras: [optionSchema],
  visible: { type: Boolean, default: true }, featured: { type: Boolean, default: false }, available: { type: Boolean, default: true }, soldOut: { type: Boolean, default: false }, order: { type: Number, default: 0 }, ...auditFields
}, { timestamps: true });
itemSchema.index({ name: 'text', description: 'text', ingredients: 'text' });

const tableSchema = new Schema({
  number: { type: String, required: true, unique: true }, displayName: String, capacity: { type: Number, required: true, min: 1 }, zone: { type: String, default: 'Main' },
  active: { type: Boolean, default: true }, state: { type: String, enum: ['available','occupied','reserved','cleaning','disabled'], default: 'available', index: true },
  qrTokenHash: { type: String, required: true, unique: true, select: false }, qrTokenEncrypted: { type: String, select: false }, qrTokenHint: String, qrVersion: { type: Number, default: 1 }, ...auditFields
}, { timestamps: true });

const tableSessionSchema = new Schema({
  table: { type: Schema.Types.ObjectId, ref: 'Table', required: true, index: true }, tokenHash: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['pending','active','closed','expired'], default: 'pending', index: true }, guestCount: { type: Number, default: 1, min: 1 },
  guestIds: [String], expiresAt: { type: Date, required: true, index: { expires: 0 } }, activatedBy: { type: Schema.Types.ObjectId, ref: 'User' }, closedAt: Date
}, { timestamps: true });

const orderItemSchema = new Schema({ menuItemId: Schema.Types.ObjectId, name: String, quantity: { type: Number, min: 1 }, basePrice: Number, variant: { name: String, priceDelta: Number }, extras: [{ name: String, priceDelta: Number }], unitPrice: Number, lineTotal: Number, notes: String }, { _id: false });
const orderSchema = new Schema({
  orderNumber: { type: String, required: true, unique: true }, tableSession: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true, index: true }, table: { type: Schema.Types.ObjectId, ref: 'Table', required: true, index: true }, guestId: String,
  idempotencyKey: { type: String, required: true }, items: { type: [orderItemSchema], required: true }, notes: String,
  subtotal: Number, discount: Number, tax: Number, serviceCharge: Number, total: Number,
  status: { type: String, enum: ['pending','accepted','preparing','ready','served','completed','rejected','cancelled'], default: 'pending', index: true },
  statusHistory: [{ status: String, at: { type: Date, default: Date.now }, by: Schema.Types.ObjectId, reason: String }], version: { type: Number, default: 0 }
}, { timestamps: true });
orderSchema.index({ tableSession: 1, idempotencyKey: 1 }, { unique: true });

const waiterCallSchema = new Schema({ tableSession: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true }, table: { type: Schema.Types.ObjectId, ref: 'Table', required: true }, type: { type: String, enum: ['waiter','urgent','bill'], required: true }, priority: { type: Number, enum: [1,2], default: 1 }, status: { type: String, enum: ['open','acknowledged','resolved','dismissed'], default: 'open' }, assignedTo: { type: Schema.Types.ObjectId, ref: 'User' }, history: [{ status: String, at: { type: Date, default: Date.now }, by: Schema.Types.ObjectId }] }, { timestamps: true });
waiterCallSchema.index({ status: 1, priority: -1, createdAt: 1 });

const reservationSchema = new Schema({ date: { type: Date, required: true, index: true }, durationMinutes: Number, partySize: { type: Number, min: 1 }, name: String, phone: String, email: String, notes: String, table: { type: Schema.Types.ObjectId, ref: 'Table', index: true }, status: { type: String, enum: ['pending','confirmed','seated','completed','cancelled','no-show'], default: 'pending' }, source: { type: String, enum: ['public','staff'], default: 'public' }, ...auditFields }, { timestamps: true });

const paymentSchema = new Schema({ bill: { type: Schema.Types.ObjectId, ref: 'Bill', required: true }, amount: money, method: { type: String, enum: ['cash','card_external','manual'], required: true }, status: { type: String, enum: ['recorded','refunded'], default: 'recorded' }, reference: String, recordedBy: { type: Schema.Types.ObjectId, ref: 'User' }, refundedAt: Date }, { timestamps: true });
const billSchema = new Schema({ billNumber: { type: String, unique: true, required: true }, tableSession: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true }, orders: [{ type: Schema.Types.ObjectId, ref: 'Order' }], subtotal: Number, discount: Number, tax: Number, serviceCharge: Number, total: Number, paid: { type: Number, default: 0 }, refunded: { type: Number, default: 0 }, status: { type: String, enum: ['open','partial','settled','refunded','void'], default: 'open' }, createdBy: { type: Schema.Types.ObjectId, ref: 'User' } }, { timestamps: true });
const notificationSchema = new Schema({ audience: String, type: String, title: String, body: String, readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }], data: Schema.Types.Mixed }, { timestamps: true });
const auditSchema = new Schema({ actor: { type: Schema.Types.ObjectId, ref: 'User' }, action: { type: String, required: true, index: true }, entityType: String, entityId: Schema.Types.ObjectId, before: Schema.Types.Mixed, after: Schema.Types.Mixed, ip: String, userAgent: String }, { timestamps: true });

export const User = models.User || model('User', userSchema);
export const RestaurantSettings = models.RestaurantSettings || model('RestaurantSettings', settingsSchema);
export const MenuCategory = models.MenuCategory || model('MenuCategory', categorySchema);
export const MenuItem = models.MenuItem || model('MenuItem', itemSchema);
export const Table = models.Table || model('Table', tableSchema);
export const TableSession = models.TableSession || model('TableSession', tableSessionSchema);
export const Order = models.Order || model('Order', orderSchema);
export const WaiterCall = models.WaiterCall || model('WaiterCall', waiterCallSchema);
export const Reservation = models.Reservation || model('Reservation', reservationSchema);
export const Bill = models.Bill || model('Bill', billSchema);
export const Payment = models.Payment || model('Payment', paymentSchema);
export const Notification = models.Notification || model('Notification', notificationSchema);
export const AuditLog = models.AuditLog || model('AuditLog', auditSchema);

