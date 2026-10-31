import { z } from 'zod';
const id = z.string().regex(/^[a-f\d]{24}$/i);
export const loginSchema = z.object({ body: z.object({ email: z.string().email(), password: z.string().min(8) }) });
export const setupSchema = z.object({ body: z.object({ name: z.string().min(2).max(100), email: z.string().email(), password: z.string().min(12).max(128) }) });
export const categorySchema = z.object({ body: z.object({ name: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/), description: z.string().optional(), visible: z.boolean().optional(), order: z.number().int().optional() }) });
const option = z.object({ name: z.string().min(1), priceDelta: z.number().int().min(0), available: z.boolean().optional() });
export const itemSchema = z.object({ body: z.object({ category: id, name: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/), description: z.string().optional(), basePrice: z.number().int().min(0), discountBps: z.number().int().min(0).max(10000).optional(), ingredients: z.array(z.string()).optional(), allergens: z.array(z.string()).optional(), dietaryLabels: z.array(z.string()).optional(), prepMinutes: z.number().int().min(0).optional(), variants: z.array(option).optional(), extras: z.array(option).optional(), visible: z.boolean().optional(), featured: z.boolean().optional(), available: z.boolean().optional(), soldOut: z.boolean().optional(), order: z.number().int().optional() }) });
export const tableSchema = z.object({ body: z.object({ number: z.string().min(1), displayName: z.string().optional(), capacity: z.number().int().min(1), zone: z.string().optional(), active: z.boolean().optional(), state: z.enum(['available','occupied','reserved','cleaning','disabled']).optional() }) });
export const sessionSchema = z.object({ body: z.object({ qrToken: z.string().min(20), guestId: z.string().min(8).max(100), guestCount: z.number().int().min(1).max(30).default(1) }) });
export const orderSchema = z.object({ body: z.object({ guestId: z.string().min(8), notes: z.string().max(500).optional(), items: z.array(z.object({ menuItemId: id, quantity: z.number().int().min(1).max(20), variantId: id.optional(), extraIds: z.array(id).max(10).optional(), notes: z.string().max(300).optional() })).min(1).max(50) }) });
export const callSchema = z.object({ body: z.object({ type: z.enum(['waiter','urgent','bill']) }) });
export const reservationSchema = z.object({ body: z.object({ date: z.coerce.date(), partySize: z.number().int().min(1).max(30), tableId: id.optional(), name: z.string().min(2), phone: z.string().min(7), email: z.string().email().optional().or(z.literal('')), notes: z.string().max(500).optional() }) });
export const settingsSchema = z.object({ body: z.object({
  name: z.string().min(1).max(120).optional(), description: z.string().max(2000).optional(), phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal('')), address: z.string().max(300).optional(), mapUrl: z.string().url().optional().or(z.literal('')),
  logoUrl: z.string().url().optional().or(z.literal('')), heroImageUrl: z.string().url().optional().or(z.literal('')), brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  timezone: z.string().max(80).optional(), currency: z.string().min(3).max(3).optional(), taxRateBps: z.number().int().min(0).max(10000).optional(),
  serviceRateBps: z.number().int().min(0).max(10000).optional(), tableSessionMinutes: z.number().int().min(5).max(1440).optional(),
  websiteTheme: z.object({
    heroEyebrow: z.string().max(100).optional(), heroTitle: z.string().max(160).optional(), heroOverlay: z.number().int().min(0).max(90).optional(),
    storyEyebrow: z.string().max(100).optional(), storyTitle: z.string().max(160).optional(), storyText: z.string().max(1500).optional(),
    storyImageUrl: z.string().url().optional().or(z.literal('')), seasonalEnabled: z.boolean().optional(),
    seasonalEffect: z.enum(['none','christmas','new_year','poya','vesak','avurudu','valentine','halloween']).optional(),
    stylePreset: z.enum(['signature','modern','minimal','tropical','monochrome']).optional(), cardStyle: z.enum(['soft','outlined','glass']).optional(),
    buttonStyle: z.enum(['pill','rounded','square']).optional(), heroAlignment: z.enum(['left','center']).optional(), contentWidth: z.enum(['comfortable','wide']).optional(),
    announcement: z.string().max(180).optional(), announcementEnabled: z.boolean().optional()
  }).optional()
}).strict() });

