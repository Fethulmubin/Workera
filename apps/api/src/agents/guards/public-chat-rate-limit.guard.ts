import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import type { Request, Response } from "express";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

@Injectable()
export class PublicChatRateLimitGuard implements CanActivate {
  private readonly records = new Map<string, RateLimitRecord>();
  private readonly limit = 30; // 30 requests
  private readonly windowMs = 60 * 1000; // 1 minute

  constructor() {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.records.entries()) {
        if (record.resetAt <= now) {
          this.records.delete(key);
        }
      }
    }, 60 * 1000);
    if (timer.unref) {
      timer.unref();
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const ip = req.ip || req.socket?.remoteAddress || "127.0.0.1";
    const anonCookie =
      (req as any).cookies?.["workera_anon_session"] ||
      req.headers["x-anonymous-session-id"];
    const clientKey = `${ip}:${anonCookie || "anon"}`;

    const now = Date.now();
    let record = this.records.get(clientKey);

    if (!record || record.resetAt <= now) {
      record = {
        count: 1,
        resetAt: now + this.windowMs,
      };
      this.records.set(clientKey, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, this.limit - record.count);
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);

    if (res && typeof res.setHeader === "function") {
      res.setHeader("X-RateLimit-Limit", this.limit);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetAt / 1000));
    }

    if (record.count > this.limit) {
      if (res && typeof res.setHeader === "function") {
        res.setHeader("Retry-After", retryAfter);
      }
      throw new HttpException(
        "Too many chat requests. Please slow down and try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
