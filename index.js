require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');
const { randomUUID } = require('crypto');
const { readFarmers, writeFarmers } = require('./lib/store');
const historyRoutes = require('./routes/history');

const app = express();
// OTPs are short-lived and held in memory for this prototype. Use a persistent store/rate limits for production.
const otpStore = new Map();
const verifiedMobiles = new Set();
app.use(cors());
app.use(express.json({limit:'100kb'}));
app.use(express.static(path.join(__dirname, '..')));
app.use('/api/history', historyRoutes);
const smsReady = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
const smsClient = () => twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const cropCalendar = {
  'Wheat': [{from:'10-25',to:'12-15',message:'Wheat sowing window is active in many north Indian plains. Confirm the locally recommended variety and date with your KVK.'}],
  'Rice / Paddy': [{from:'05-25',to:'07-15',message:'Paddy nursery/transplanting season may be approaching. Follow Punjab Agriculture University/KVK local advisories and water-saving guidance.'}],
  'Maize': [{from:'02-15',to:'03-31',message:'Spring maize sowing window may be active. Confirm soil temperature, hybrid and local schedule with KVK.'},{from:'06-15',to:'07-15',message:'Kharif maize sowing window may be active. Check local rainfall and drainage before sowing.'}],
  'Cotton': [{from:'04-01',to:'05-15',message:'Cotton sowing window may be active in suitable regions. Confirm approved variety and local pest-management advice.'}],
  'Mustard': [{from:'09-25',to:'11-15',message:'Mustard sowing window may be active. Confirm local variety and sowing date with KVK.'}],
  'Vegetables': [{from:'01-01',to:'12-31',message:'Vegetable sowing dates vary by crop and season. Please check the selected vegetable and local KVK calendar.'}]
};
function inWindow(window, date=new Date()) {
  const mmdd = `${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  return window.from <= window.to ? mmdd >= window.from && mmdd <= window.to : (mmdd >= window.from || mmdd <= window.to);
}
async function geocode(location) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
  const r = await fetch(url); if (!r.ok) throw new Error('Location lookup failed');
  const data = await r.json(); if (!data.results?.length) throw new Error('Location not found. Enter village, district or city.');
  const p=data.results[0]; return {latitude:p.latitude,longitude:p.longitude,displayName:[p.name,p.admin1,p.country].filter(Boolean).join(', ')};
}
async function weatherFor(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&timezone=auto&forecast_days=7`;
  const r=await fetch(url); if(!r.ok) throw new Error('Weather provider unavailable'); return r.json();
}
function weatherText(code) {
  if(code===0)return 'Clear sky'; if([1,2,3].includes(code))return 'Partly cloudy'; if([45,48].includes(code))return 'Fog';
  if([51,53,55,56,57].includes(code))return 'Drizzle'; if([61,63,65,66,67].includes(code))return 'Rain';
  if([71,73,75,77,85,86].includes(code))return 'Snow'; if([80,81,82].includes(code))return 'Rain showers'; if([95,96,99].includes(code))return 'Thunderstorm'; return 'Weather update';
}
app.get('/api/health', (_req,res)=>res.json({ok:true,smsConfigured:smsReady(),historicalPricesConfigured:!!process.env.DATA_GOV_API_KEY}));

app.post('/api/otp/send', async (req,res)=>{
  try {
    const mobile=String(req.body.mobile||'').replace(/\D/g,'');
    const purpose=String(req.body.purpose||'signup');
    if(!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({error:'Enter a valid Indian 10-digit mobile number.'});
    if(!['signup','login'].includes(purpose)) return res.status(400).json({error:'Invalid OTP purpose.'});
    if(purpose==='login' && !readFarmers().some(f=>f.mobile===mobile)) return res.status(404).json({error:'Invalid user: mobile number is not registered in farmers.json.'});
    const code=String(Math.floor(100000+Math.random()*900000));
    otpStore.set(`${purpose}:${mobile}`,{code,expiresAt:Date.now()+5*60*1000,attempts:0});
    if(smsReady()) {
      await sendSms(mobile,`Your KrishiMitra verification OTP is ${code}. Valid for 5 minutes. Do not share it.`);
      return res.json({ok:true,message:'OTP sent by SMS. Valid for 5 minutes.'});
    }
    // Explicit local-demo fallback; never deploy this mode publicly.
    console.log(`[DEMO OTP] ${purpose} ${mobile}: ${code}`);
    return res.json({ok:true,message:'Demo mode: OTP is shown here because SMS credentials are not configured.',demoOtp:code,demo:true});
  } catch(e) { res.status(502).json({error:e.message||'Could not send OTP.'}); }
});
app.post('/api/otp/verify', (req,res)=>{
  const mobile=String(req.body.mobile||'').replace(/\D/g,'');
  const purpose=String(req.body.purpose||'signup');
  const code=String(req.body.otp||'').trim();
  const key=`${purpose}:${mobile}`, record=otpStore.get(key);
  if(!record || Date.now()>record.expiresAt) { otpStore.delete(key); return res.status(400).json({error:'OTP expired or not requested. Send a new OTP.'}); }
  record.attempts++;
  if(record.attempts>5) { otpStore.delete(key); return res.status(429).json({error:'Too many attempts. Request a new OTP.'}); }
  if(record.code!==code) return res.status(400).json({error:'Incorrect OTP. Try again.'});
  otpStore.delete(key); verifiedMobiles.add(`${purpose}:${mobile}`);
  return res.json({ok:true,verified:true,message:'OTP verified successfully.'});
});
app.post('/api/farmers/login', (req,res)=>{
  const mobile=String(req.body.mobile||'').replace(/\D/g,'');
  const name=String(req.body.name||'').trim().toLowerCase();
  if(!verifiedMobiles.has(`login:${mobile}`)) return res.status(401).json({error:'Verify OTP first.'});
  const farmer=readFarmers().find(f=>f.mobile===mobile && String(f.name||'').trim().toLowerCase()===name);
  if(!farmer) return res.status(404).json({error:'Invalid user: name/mobile not found in farmers.json.'});
  const {id,name:farmerName,state,crop,location,smsConsent}=farmer;
  res.json({ok:true,message:'Farmer verified. Profile opened.',farmer:{id,name:farmerName,mobile:farmer.mobile,state,crop,location,smsConsent}});
});

app.post('/api/farmers', async (req,res)=>{
  try {
    const {name,mobile,state,crop,location,smsConsent}=req.body;
    if(!verifiedMobiles.has(`signup:${String(mobile||'')}`)) return res.status(401).json({error:'Verify mobile OTP before saving farmer profile.'});
    if(!/^[6-9]\d{9}$/.test(String(mobile||''))) return res.status(400).json({error:'Enter a valid Indian 10-digit mobile number.'});
    if(!location || !String(location).trim()) return res.status(400).json({error:'Enter village, district or city for local weather.'});
    const geo=await geocode(location); const farmers=readFarmers();
    const existing=farmers.find(x=>x.mobile===String(mobile));
    const farmer={id:existing?.id || randomUUID(),name:String(name||'Farmer').slice(0,80),mobile:String(mobile),state:String(state||''),crop:String(crop||'Wheat'),location:String(location),geo,smsConsent:smsConsent===true,createdAt:new Date().toISOString(),lastWeatherAlertDate:null,lastSowingAlertKey:null};
    const idx=farmers.findIndex(x=>x.mobile===farmer.mobile); if(idx>=0) farmers[idx]={...farmers[idx],...farmer}; else farmers.push(farmer);
    writeFarmers(farmers); res.json({ok:true,farmer:{id:farmer.id,name:farmer.name,mobile:farmer.mobile,crop:farmer.crop,location:geo.displayName},smsConfigured:smsReady(),message:farmer.smsConsent?(smsReady()?'Profile saved. Scheduled SMS alerts are enabled.':'Profile saved. Add Twilio credentials in .env to enable SMS.'):'Profile saved. Weather is available; tick SMS consent to enroll in automatic alerts.'});
  } catch(e) {res.status(400).json({error:e.message});}
});
app.get('/api/weather', async (req,res)=>{
  try {
    const mobile=String(req.query.mobile||''); const farmer=readFarmers().find(x=>x.mobile===mobile);
    if(!farmer) return res.status(404).json({error:'Farmer profile not found on server. Save profile first.'});
    const raw=await weatherFor(farmer.geo.latitude,farmer.geo.longitude); const d=raw.daily;
    const days=d.time.map((date,i)=>({date,description:weatherText(d.weather_code[i]),maxC:d.temperature_2m_max[i],minC:d.temperature_2m_min[i],rainChance:d.precipitation_probability_max[i],rainMm:d.precipitation_sum[i]}));
    res.json({location:farmer.geo.displayName,days,source:'Open-Meteo'});
  } catch(e){res.status(502).json({error:e.message});}
});
app.get('/api/sowing-calendar', (_req,res)=>res.json({calendar:cropCalendar,disclaimer:'Indicative seasonal windows only. Actual sowing dates vary by district, variety, irrigation and current PAU/KVK advisories.'}));
app.get('/api/market/last-year', async (req,res)=>{
  const crop=String(req.query.crop||'Wheat'); const state=String(req.query.state||'Punjab');
  if(!process.env.DATA_GOV_API_KEY) return res.status(503).json({error:'Historical mandi data is not configured. Add DATA_GOV_API_KEY in .env. No sample prices are shown as real prices.'});
  try {
    const resource='9ef84268-d588-465a-a308-a864a43d0070';
    const cutoff=new Date(); cutoff.setFullYear(cutoff.getFullYear()-1);
    const rows=[]; let offset=0; const pageSize=1000;
    for(let page=0;page<10;page++){
      const params=new URLSearchParams({'api-key':process.env.DATA_GOV_API_KEY,format:'json',limit:String(pageSize),offset:String(offset),'sort[arrival_date]':'desc',['filters[commodity]']:crop,['filters[state]']:state});
      const r=await fetch(`https://api.data.gov.in/resource/${resource}?${params.toString()}`); if(!r.ok) throw new Error('Agmarknet data service unavailable');
      const data=await r.json(); const batch=data.records||[]; if(!batch.length)break;
      for(const x of batch){const dt=new Date(x.arrival_date);if(!Number.isNaN(dt.getTime())&&dt>=cutoff)rows.push(x);}
      const dates=batch.map(x=>new Date(x.arrival_date)).filter(d=>!Number.isNaN(d.getTime()));
      if(dates.length && Math.min(...dates)<cutoff)break;
      if(batch.length<pageSize)break; offset+=pageSize;
    }
    const byVariety={}; for(const x of rows){const price=Number(x.modal_price||0);if(price>0){const v=x.variety||'Variety not specified';(byVariety[v]??=[]).push(price);}}
    const top=Object.entries(byVariety).map(([variety,prices])=>({variety,records:prices.length,averageModalPrice:Math.round(prices.reduce((a,b)=>a+b,0)/prices.length),min:Math.min(...prices),max:Math.max(...prices)})).sort((a,b)=>b.averageModalPrice-a.averageModalPrice).slice(0,3);
    res.json({crop,state,period:'Last 12 months',unit:'INR per quintal',topVarieties:top,source:'data.gov.in Agmarknet',recordsUsed:rows.length});
  } catch(e){res.status(502).json({error:e.message});}
});
async function sendSms(to,body){if(!smsReady()) throw new Error('Twilio is not configured');return smsClient().messages.create({from:process.env.TWILIO_PHONE_NUMBER,to:`+91${to}`,body});}
async function runDailyAlerts(){
  if(!smsReady()){console.log('[alerts] Twilio not configured; skipping SMS run.');return;}
  const farmers=readFarmers(); const today=new Date().toISOString().slice(0,10);
  for(const f of farmers){if(!f.smsConsent)continue;
    try {
      if(f.lastWeatherAlertDate!==today){const w=await weatherFor(f.geo.latitude,f.geo.longitude);const d=w.daily;
        const daily=(d.time||[]).slice(0,7).map((date,i)=>`${date.slice(5)} ${d.temperature_2m_min[i]}-${d.temperature_2m_max[i]}C rain ${d.precipitation_probability_max[i]??0}%`).join('; ');
        const msg=`KrishiMitra 7-day weather for ${f.geo.displayName}: ${daily}. Check local conditions before irrigation/spraying. Source: Open-Meteo.`;
        await sendSms(f.mobile,msg);f.lastWeatherAlertDate=today;
      }
      const windows=cropCalendar[f.crop]||[];const active=windows.find(x=>inWindow(x));
      if(active){const key=`${f.crop}:${new Date().getFullYear()}:${active.from}`;if(f.lastSowingAlertKey!==key){await sendSms(f.mobile,`KrishiMitra sowing reminder for ${f.crop}: ${active.message} This is a seasonal reminder, not a guaranteed recommendation.`);f.lastSowingAlertKey=key;}}
    } catch(e){console.error(`[alerts] ${f.mobile}:`,e.message);}
  }
  writeFarmers(farmers);
}
// Runs daily at 07:00 in configured timezone. Start server continuously for scheduled SMS.
cron.schedule('0 7 * * *',runDailyAlerts,{timezone:process.env.ALERT_TIMEZONE||'Asia/Kolkata'});
app.post('/api/admin/run-alerts', async (_req,res)=>{await runDailyAlerts();res.json({ok:true,message:'Alert run completed. Check server logs and Twilio delivery status.'});});
const port=Number(process.env.PORT||3000); app.listen(port,()=>console.log(`KrishiMitra running at http://localhost:${port}`));
