import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, headers, body, query, params } = req;
    const startTime = Date.now();

    this.logger.log(
      `Incoming Request: ${method} ${originalUrl} | Params: ${JSON.stringify(
        params,
      )} | Query: ${JSON.stringify(query)} | Body: ${JSON.stringify(body)}`,
    );

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      this.logger.log(
        `Response: ${method} ${originalUrl} | Status: ${res.statusCode} | Duration: ${duration}ms`,
      );
    });
    next();
  }
}
