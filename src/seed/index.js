import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { MenuCategory, MenuItem, RestaurantSettings, Table } from '../models/index.js';
import { hashToken, token } from '../utils/core.js';
await mongoose.connect(env.MONGODB_URI);
await RestaurantSettings.updateOne({singletonKey:'primary'},{$setOnInsert:{name:'Saffron & Stone',description:'Modern Sri Lankan cooking, shaped by fire, spice and the island harvest.',address:'Colombo, Sri Lanka',phone:'+94 11 555 0142',email:'hello@saffronandstone.lk',taxRateBps:0,serviceRateBps:1000,openingHours:[0,1,2,3,4,5,6].map(day=>({day,open:'11:30',close:'23:00',closed:false}))}},{upsert:true});
const mains=await MenuCategory.findOneAndUpdate({slug:'mains'},{$setOnInsert:{name:'From the Fire',slug:'mains',description:'Ember-led plates and slow-cooked favourites',order:1}},{upsert:true,new:true});
const small=await MenuCategory.findOneAndUpdate({slug:'small-plates'},{$setOnInsert:{name:'Small Plates',slug:'small-plates',order:0}},{upsert:true,new:true});
const dishes=[{category:small.id,name:'Crisp Hopper Tacos',slug:'crisp-hopper-tacos',description:'Spiced jackfruit, coconut sambol, lime',basePrice:185000,dietaryLabels:['vegan'],prepMinutes:12,featured:true},{category:mains.id,name:'Charred Lagoon Prawns',slug:'charred-lagoon-prawns',description:'Curry leaf butter, tamarind, grilled lime',basePrice:390000,allergens:['shellfish','dairy'],prepMinutes:18,featured:true},{category:mains.id,name:'Black Pork Curry',slug:'black-pork-curry',description:'Roasted spice, heirloom rice, tempered greens',basePrice:325000,prepMinutes:22,featured:true}];
for(const dish of dishes)await MenuItem.updateOne({slug:dish.slug},{$setOnInsert:dish},{upsert:true});
for(const number of ['01','02','03','04']){if(!await Table.exists({number})){const raw=token(32);await Table.create({number,displayName:`Table ${number}`,capacity:Number(number)>2?6:4,zone:Number(number)>2?'Garden':'Dining Room',qrTokenHash:hashToken(raw),qrTokenHint:raw.slice(-6)});console.log(`Table ${number} QR token (shown once): ${raw}`);}}
console.log('Sample restaurant data created. Use /api/v1/auth/setup to create the first owner securely.');await mongoose.disconnect();

