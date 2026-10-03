import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { PrismaService } from "../database/prisma.service";
import { AgentExecutionService } from "./agent-execution.service";
import { PublicChatDto } from "./dto/public-chat.dto";
import { PublicChatRateLimitGuard } from "./guards/public-chat-rate-limit.guard";
import * as crypto from "crypto";

@Controller("public/agents")
@UseGuards(PublicChatRateLimitGuard)
export class PublicAgentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentExecutionService: AgentExecutionService,
  ) {}

  private parseCookie(
    cookieHeader: string | undefined,
    name: string,
  ): string | undefined {
    if (!cookieHeader) return undefined;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : undefined;
  }

  private resolveAnonymousSession(req: Request, res?: Response): string {
    const rawCookie =
      (req as any).cookies?.["workera_anon_session"] ||
      this.parseCookie(req.headers.cookie, "workera_anon_session");
    const rawHeader = req.headers["x-anonymous-session-id"];

    const candidate =
      typeof rawCookie === "string" && rawCookie.trim()
        ? rawCookie.trim()
        : typeof rawHeader === "string" && rawHeader.trim()
        ? rawHeader.trim()
        : null;

    const isValid = candidate && /^[a-zA-Z0-9_-]{10,64}$/.test(candidate);
    const sessionId = isValid ? candidate : crypto.randomUUID();

    if (res) {
      if (typeof res.cookie === "function") {
        res.cookie("workera_anon_session", sessionId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 30 * 24 * 60 * 60 * 1000,
          path: "/",
        });
      }
      if (typeof res.setHeader === "function") {
        res.setHeader("x-anonymous-session-id", sessionId);
      }
    }

    return sessionId;
  }

  @Post(":agentId/chat")
  async chat(
    @Param("agentId") agentId: string,
    @Body() dto: PublicChatDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { organization: true },
    });

    if (!agent || !agent.isPublic || !agent.organization) {
      throw new NotFoundException(
        "Agent not found or is not publicly accessible",
      );
    }

    if (!agent.isActive) {
      throw new BadRequestException(
        "Agent is inactive and cannot execute conversations",
      );
    }

    const sessionId = this.resolveAnonymousSession(req, res);

    const result = await this.agentExecutionService.executeChat(
      agent.organizationId,
      agent.id,
      dto.message,
      dto.conversationId,
      { anonymousSessionId: sessionId },
    );

    return {
      conversationId: result.conversationId,
      message: {
        id: result.message.id,
        role: result.message.role,
        content: result.message.content,
        createdAt: result.message.createdAt,
      },
      citations: result.citations,
      anonymousSessionId: sessionId,
    };
  }

  @Post(":agentId/chat/stream")
  chatStream(
    @Param("agentId") agentId: string,
    @Body() dto: PublicChatDto,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    (async () => {
      try {
        const agent = await this.prisma.agent.findUnique({
          where: { id: agentId },
          include: { organization: true },
        });

        if (!agent || !agent.isPublic || !agent.organization) {
          throw new NotFoundException(
            "Agent not found or is not publicly accessible",
          );
        }

        if (!agent.isActive) {
          throw new BadRequestException(
            "Agent is inactive and cannot execute conversations",
          );
        }

        const sessionId = this.resolveAnonymousSession(req, res);

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");

        const stream$ = this.agentExecutionService.executeChatStream(
          agent.organizationId,
          agent.id,
          dto.message,
          dto.conversationId,
          { anonymousSessionId: sessionId },
        );

        const subscription = stream$.subscribe({
          next: (event) => {
            res.write(`data: ${event.data}\n\n`);
          },
          error: (err) => {
            res.write(
              `data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`,
            );
            res.end();
          },
          complete: () => {
            res.end();
          },
        });

        res.on("close", () => {
          subscription.unsubscribe();
        });
      } catch (err: any) {
        if (!res.headersSent) {
          const status = err.status || 500;
          res.status(status).json({
            statusCode: status,
            message: err.message,
          });
        }
      }
    })();
  }
}
