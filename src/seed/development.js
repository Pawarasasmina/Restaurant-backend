import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { MenuCategory, MenuItem, RestaurantSettings, Table, User } from '../models/index.js';
import { encryptToken, hashToken, token } from '../utils/core.js';

if (env.NODE_ENV === 'production') throw new Error('Fixed-credential development seed is disabled in production.');
await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

await RestaurantSettings.findOneAndUpdate({ singletonKey: 'primary' }, { $set: {
  name: 'Saffron & Stone', description: 'Modern Sri Lankan cooking shaped by fire, spice, coastal produce, and the island harvest.',
  logoUrl: 'https://images.unsplash.com/photo-1572715376701-98568319fd0b?auto=format&fit=crop&w=400&q=85',
  heroImageUrl: 'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1800&q=90', brandColor: '#8c3b2a',
  address: '42 Galle Road, Colombo 03, Sri Lanka', mapUrl: 'https://maps.google.com/?q=Colombo+03+Sri+Lanka', phone: '+94 11 555 0142', email: 'hello@saffronandstone.lk',
  socialLinks: { instagram: 'https://instagram.com/', facebook: 'https://facebook.com/' }, timezone: 'Asia/Colombo', currency: 'LKR', taxRateBps: 0, serviceRateBps: 1000,
  reservationRules: { leadMinutes: 60, durationMinutes: 120, maxPartySize: 16 }, tableSessionMinutes: 240,
  openingHours: [0,1,2,3,4,5,6].map(day => ({ day, open: '11:30', close: day > 3 ? '23:30' : '22:30', closed: false })),
  gallery: ['https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1200&q=85','https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=85','https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=1200&q=85'],
  testimonials: [{ name: 'Nimali Perera', quote: 'Beautifully balanced food and genuinely warm service.', visible: true },{ name: 'Daniel Fernando', quote: 'Sri Lankan flavours presented with imagination and respect.', visible: true }]
} }, { upsert: true, new: true, runValidators: true });

const categoryRows = [
  ['small-plates','Small Plates','Bright, shareable beginnings'],['from-the-fire','From the Fire','Charcoal, smoke, and slow cooking'],
  ['rice-and-curry','Rice & Curry','Island comfort served with heirloom rice'],['plant-kitchen','Plant Kitchen','Vegetables, grains, and coconut'],
  ['desserts','Desserts','Tropical fruit and spice'],['drinks','Drinks','Coolers, tea, and coffee']
];
const categories = {};
for (const [slug,name,description] of categoryRows) categories[slug] = await MenuCategory.findOneAndUpdate({ slug }, { $set: { slug,name,description,visible:true,order:Object.keys(categories).length } }, { upsert:true,new:true,runValidators:true });

const itemRows = [
 ['small-plates','Crisp Hopper Tacos','crisp-hopper-tacos','Mini hopper shells, spiced jackfruit, coconut sambol, and lime.',185000,'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=1000&q=85',['vegan','gluten-free'],[],true],
 ['small-plates','Hot Butter Cuttlefish','hot-butter-cuttlefish','Crisp cuttlefish, chilli butter, spring onion, and sesame.',245000,'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?auto=format&fit=crop&w=1000&q=85',[],['shellfish','dairy','sesame'],false],
 ['from-the-fire','Charred Lagoon Prawns','charred-lagoon-prawns','Curry leaf butter, tamarind glaze, and grilled lime.',390000,'https://images.unsplash.com/photo-1559847844-5315695dadae?auto=format&fit=crop&w=1000&q=85',['gluten-free'],['shellfish','dairy'],true],
 ['from-the-fire','Black Pork Curry','black-pork-curry','Roasted goraka spice, heirloom rice, and tempered greens.',325000,'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=1000&q=85',['gluten-free'],[],true],
 ['from-the-fire','Jaffna Lamb Chops','jaffna-lamb-chops','Jaffna spice crust, smoked aubergine, mint, and shallots.',485000,'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1000&q=85',['gluten-free'],[],true],
 ['rice-and-curry','Ceylon Chicken Rice & Curry','ceylon-chicken-rice-curry','Clay-pot chicken, dhal, three vegetables, sambol, and red rice.',275000,'https://images.unsplash.com/photo-1631292784640-2b24be784d5d?auto=format&fit=crop&w=1000&q=85',['gluten-free'],[],false],
 ['rice-and-curry','Southern Fish Ambul Thiyal','fish-ambul-thiyal','Sour black fish curry, coconut rice, dhal, and gotukola sambol.',310000,'https://images.unsplash.com/photo-1601050690117-94f5f6fa8bd7?auto=format&fit=crop&w=1000&q=85',['gluten-free'],['fish'],false],
 ['plant-kitchen','Roasted Pumpkin Curry','roasted-pumpkin-curry','Wood-roasted pumpkin, coconut curry, cashew, and curry leaf oil.',225000,'https://images.unsplash.com/photo-1596797038530-2c107229654b?auto=format&fit=crop&w=1000&q=85',['vegan','gluten-free'],['tree nuts'],true],
 ['plant-kitchen','Beetroot String Hoppers','beetroot-string-hoppers','String hoppers, beetroot kiri hodi, dhal, and pol sambol.',195000,'https://images.unsplash.com/photo-1505253758473-96b7015fcd40?auto=format&fit=crop&w=1000&q=85',['vegan','gluten-free'],[],false],
 ['desserts','Watalappan Brûlée','watalappan-brulee','Kitul palm custard, nutmeg, cashew praline, and coconut cream.',145000,'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=1000&q=85',['vegetarian'],['egg','tree nuts'],true],
 ['desserts','Coconut & Mango Pavlova','coconut-mango-pavlova','Meringue, fresh mango, coconut cream, and passionfruit.',165000,'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=1000&q=85',['vegetarian','gluten-free'],['egg'],false],
 ['drinks','Ceylon Iced Tea','ceylon-iced-tea','Single-estate black tea, citrus, mint, and kitul syrup.',75000,'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=1000&q=85',['vegan','gluten-free'],[],false],
 ['drinks','King Coconut Cooler','king-coconut-cooler','Fresh king coconut, lime, sea salt, and basil seed.',85000,'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=1000&q=85',['vegan','gluten-free'],[],true],
 ['drinks','Spiced Iced Coffee','spiced-iced-coffee','Sri Lankan coffee, condensed milk, cardamom, and cinnamon.',95000,'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=1000&q=85',['vegetarian'],['dairy'],false]
];
for (const [category,name,slug,description,basePrice,imageUrl,dietaryLabels,allergens,featured] of itemRows) await MenuItem.findOneAndUpdate({ slug }, { $set: { category:categories[category]._id,name,slug,description,basePrice,imageUrl,dietaryLabels,allergens,featured,visible:true,available:true,soldOut:false,prepMinutes:15,ingredients:[],variants:[],extras:[] } }, { upsert:true,new:true,runValidators:true });

const tableRows = [['01','Window 01',2,'Dining Room'],['02','Window 02',2,'Dining Room'],['03','Dining 03',4,'Dining Room'],['04','Dining 04',4,'Dining Room'],['05','Dining 05',6,'Dining Room'],['06','Garden 06',4,'Garden'],['07','Garden 07',4,'Garden'],['08','Garden 08',8,'Garden'],['09','Private 09',10,'Private Room'],['10','Bar 10',2,'Bar']];
const newQrs=[];
for(const [number,displayName,capacity,zone] of tableRows){let table=await Table.findOne({number}).select('+qrTokenHash +qrTokenEncrypted');if(!table){const raw=token(32);table=await Table.create({number,displayName,capacity,zone,active:true,state:'available',qrTokenHash:hashToken(raw),qrTokenEncrypted:encryptToken(raw),qrTokenHint:raw.slice(-6)});newQrs.push({table:number,qrToken:raw});}else{Object.assign(table,{displayName,capacity,zone,active:true});await table.save();}}

const admin=await User.findOneAndUpdate({email:'admin@gmail.com'},{$set:{name:'Restaurant Admin',passwordHash:await bcrypt.hash('12341234',12),role:'owner',active:true,failedLogins:0},$unset:{lockedUntil:1}},{upsert:true,new:true,runValidators:true});
console.log(`Seed complete: ${categoryRows.length} categories, ${itemRows.length} menu items, ${tableRows.length} tables.`);
console.log(`Development owner: ${admin.email}`);
if(newQrs.length){console.log('New QR tokens (shown once):');console.table(newQrs);}else console.log('Existing table QR tokens preserved.');
await mongoose.disconnect();
