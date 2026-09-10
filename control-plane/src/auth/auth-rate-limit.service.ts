import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma.service';

type Bucket = { label:string;limit:number;windowMs:number;blockMs:number;keyHash:string };
export type AccountLockoutState={failures:number;lockoutLevel:number;blockedUntil:Date|null};

@Injectable()
export class AuthRateLimitService {
  constructor(private readonly prisma:PrismaService) {}

  private key(label:string,value:string):string {
    const secret=process.env.AUTH_RATE_LIMIT_SECRET||process.env.JWT_SECRET||'change-me-user-secret';
    return createHmac('sha256',secret).update(`${label}\0${value}`).digest('hex');
  }
  private normalizedEmail(email:string){return email.trim().toLowerCase();}
  private accountKey(email:string){return this.key('login-account-escalating',this.normalizedEmail(email));}
  private ipBucket(ip:string):Bucket{return{label:'login-ip',keyHash:this.key('login-ip',(ip||'unknown').trim().slice(0,128)),limit:20,windowMs:15*60_000,blockMs:30*60_000};}
  registrationIpHash(ip:string):string{return this.key('registration-ip-lifetime',(ip||'unknown').trim().slice(0,128));}

  async assertLoginAllowed(email:string,ip:string):Promise<void>{
    const now=new Date();
    const blocked=await this.prisma.authRateLimit.findFirst({where:{keyHash:{in:[this.accountKey(email),this.ipBucket(ip).keyHash]},blockedUntil:{gt:now}},select:{blockedUntil:true},orderBy:{blockedUntil:'desc'}});
    if(blocked?.blockedUntil)this.throwLockout(blocked.blockedUntil,now);
  }

  async recordLoginFailure(email:string,ip:string):Promise<AccountLockoutState|null>{
    await this.incrementWindowBucket(this.ipBucket(ip));
    const keyHash=this.accountKey(email),now=new Date();
    const rows=await this.prisma.$queryRaw<AccountLockoutState[]>`
      INSERT INTO "auth_rate_limits"
        ("key_hash","failures","window_started_at","blocked_until","lockout_level","updated_at")
      VALUES (${keyHash},1,${now},NULL,0,${now})
      ON CONFLICT ("key_hash") DO UPDATE SET
        "failures"=CASE WHEN "auth_rate_limits"."failures"+1>=3 THEN 0 ELSE "auth_rate_limits"."failures"+1 END,
        "window_started_at"=${now},
        "blocked_until"=CASE WHEN "auth_rate_limits"."failures"+1>=3 THEN ${now}+
          CASE
            WHEN "auth_rate_limits"."lockout_level"=0 THEN INTERVAL '5 minutes'
            WHEN "auth_rate_limits"."lockout_level"=1 THEN INTERVAL '30 minutes'
            WHEN "auth_rate_limits"."lockout_level"=2 THEN INTERVAL '3 hours'
            ELSE INTERVAL '24 hours'
          END
          ELSE NULL END,
        "lockout_level"=CASE WHEN "auth_rate_limits"."failures"+1>=3 THEN LEAST("auth_rate_limits"."lockout_level"+1,4) ELSE "auth_rate_limits"."lockout_level" END,
        "updated_at"=${now}
      RETURNING "failures", "lockout_level" AS "lockoutLevel", "blocked_until" AS "blockedUntil"
    `;
    this.cleanupOccasionally();
    const state=rows[0]||null;
    return state?.blockedUntil&&state.blockedUntil>now?state:null;
  }

  async recordLoginSuccess(email:string,_ip:string):Promise<void>{
    // Successful authentication is the only event that resets escalation.
    await this.prisma.authRateLimit.deleteMany({where:{keyHash:this.accountKey(email)}});
  }

  throwActiveLockout(state:AccountLockoutState):never{this.throwLockout(state.blockedUntil||new Date(Date.now()+60_000),new Date());}

  async getAccountState(email:string):Promise<AccountLockoutState>{
    const row=await this.prisma.authRateLimit.findUnique({where:{keyHash:this.accountKey(email)},select:{failures:true,lockoutLevel:true,blockedUntil:true}});
    return row||{failures:0,lockoutLevel:0,blockedUntil:null};
  }

  async consumeRegistration(ip:string):Promise<void>{await this.consume({label:'register-ip',keyHash:this.key('register-ip',(ip||'unknown').trim().slice(0,128)),limit:5,windowMs:60*60_000,blockMs:60*60_000});}
  async consumeVerificationResend(ip:string):Promise<void>{await this.consume({label:'verification-resend-ip',keyHash:this.key('verification-resend-ip',(ip||'unknown').trim().slice(0,128)),limit:5,windowMs:60*60_000,blockMs:60*60_000});}
  async consumePairing(ip:string):Promise<void>{await this.consume({label:'pairing-ip',keyHash:this.key('pairing-ip',(ip||'unknown').trim().slice(0,128)),limit:10,windowMs:60_000,blockMs:60_000},'Too many pairing attempts.');}
  async consumeSteamVerify(ip:string):Promise<void>{await this.consume({label:'steam-verify-ip',keyHash:this.key('steam-verify-ip',(ip||'unknown').trim().slice(0,128)),limit:20,windowMs:15*60_000,blockMs:15*60_000},'Too many Steam verification attempts.');}
  async consumePlayerPortalRegister(ip:string):Promise<void>{await this.consume({label:'player-portal-register-ip',keyHash:this.key('player-portal-register-ip',(ip||'unknown').trim().slice(0,128)),limit:8,windowMs:60*60_000,blockMs:60*60_000},'Too many account attempts.');}
  async consumePlayerPortalLogin(ip:string):Promise<void>{await this.consume({label:'player-portal-login-ip',keyHash:this.key('player-portal-login-ip',(ip||'unknown').trim().slice(0,128)),limit:20,windowMs:15*60_000,blockMs:15*60_000},'Too many sign-in attempts.');}
  async consumeDonationCheckout(ip:string,playerId:string):Promise<void>{
    await this.consume({label:'donation-checkout-ip',keyHash:this.key('donation-checkout-ip',(ip||'unknown').trim().slice(0,128)),limit:10,windowMs:15*60_000,blockMs:15*60_000},'Too many donation attempts.');
    await this.consume({label:'donation-checkout-player',keyHash:this.key('donation-checkout-player',(playerId||'unknown').trim().slice(0,64)),limit:8,windowMs:15*60_000,blockMs:15*60_000},'Too many donation attempts.');
  }
  async consumeStripeWebhook(ip:string):Promise<void>{await this.consume({label:'stripe-webhook-ip',keyHash:this.key('stripe-webhook-ip',(ip||'unknown').trim().slice(0,128)),limit:120,windowMs:60_000,blockMs:60_000},'Too many payment webhook requests.');}

  private async consume(bucket:Bucket,message='Too many requests.'){await this.assertKeysAllowed([bucket.keyHash],message);await this.incrementWindowBucket(bucket);this.cleanupOccasionally();}
  private async assertKeysAllowed(keys:string[],message='Too many requests.'){const now=new Date();const row=await this.prisma.authRateLimit.findFirst({where:{keyHash:{in:keys},blockedUntil:{gt:now}},select:{blockedUntil:true}});if(row?.blockedUntil)this.throwLockout(row.blockedUntil,now,message);}
  private throwLockout(until:Date,now:Date,message='Account temporarily locked after repeated failed sign-in attempts.'):never{const retryAfter=Math.max(1,Math.ceil((until.getTime()-now.getTime())/1000));throw new HttpException({statusCode:429,message,retryAfter,blockedUntil:until.toISOString()},HttpStatus.TOO_MANY_REQUESTS);}

  private async incrementWindowBucket(bucket:Bucket):Promise<void>{
    const now=new Date(),cutoff=new Date(now.getTime()-bucket.windowMs),blockedUntil=new Date(now.getTime()+bucket.blockMs);
    await this.prisma.$executeRaw`
      INSERT INTO "auth_rate_limits" ("key_hash","failures","window_started_at","blocked_until","lockout_level","updated_at")
      VALUES (${bucket.keyHash},1,${now},NULL,0,${now})
      ON CONFLICT ("key_hash") DO UPDATE SET
        "failures"=CASE WHEN "auth_rate_limits"."window_started_at"<${cutoff} THEN 1 ELSE "auth_rate_limits"."failures"+1 END,
        "window_started_at"=CASE WHEN "auth_rate_limits"."window_started_at"<${cutoff} THEN ${now} ELSE "auth_rate_limits"."window_started_at" END,
        "blocked_until"=CASE WHEN "auth_rate_limits"."window_started_at"<${cutoff} THEN NULL WHEN "auth_rate_limits"."failures"+1>=${bucket.limit} THEN ${blockedUntil} ELSE "auth_rate_limits"."blocked_until" END,
        "updated_at"=${now}
    `;
  }
  private cleanupOccasionally(){if(Math.random()>=.01)return;const cutoff=new Date(Date.now()-48*60*60_000);void this.prisma.authRateLimit.deleteMany({where:{lockoutLevel:0,updatedAt:{lt:cutoff}}}).catch(()=>undefined);}
}

export const LOGIN_LOCKOUT_POLICY=[
  {afterFailures:3,durationMinutes:5,label:'5 minutes'},
  {afterFailures:3,durationMinutes:30,label:'30 minutes'},
  {afterFailures:3,durationMinutes:180,label:'3 hours'},
  {afterFailures:3,durationMinutes:1440,label:'24 hours'},
] as const;
