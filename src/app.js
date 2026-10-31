import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import router from './routes/index.js';
import { errors, notFound } from './middleware/index.js';
import { env } from './config/env.js';
import { AppError } from './utils/core.js';
export const createApp = io => { const app=express();if(env.TRUST_PROXY)app.set('trust proxy',1);app.set('io',io);app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));app.use(cors({origin:env.FRONTEND_URL,credentials:true,methods:['GET','POST','PUT','PATCH','DELETE'],allowedHeaders:['Content-Type','Authorization','Idempotency-Key','X-Table-Session','X-App-Request']}));app.use(rateLimit({windowMs:60000,limit:180,standardHeaders:true,legacyHeaders:false}));app.use(express.json({limit:'1mb'}));app.use(cookieParser(env.COOKIE_SECRET));app.use((req,_res,next)=>{req.requestId=crypto.randomUUID();next();});app.use('/api/v1',(req,_res,next)=>{if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.get('x-app-request')!=='restaurant-web')return next(new AppError(403,'Request origin could not be verified','CSRF_CHECK_FAILED'));next();},router);app.use(notFound);app.use(errors);return app;};

