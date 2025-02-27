import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TokenService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;
  private subscriber: Redis;
  private readonly TOKEN_EXPIRY: number;
  private readonly KEEP_ALIVE_EXPIRY: number;
  private readonly logger = new Logger(TokenService.name);

  constructor(private readonly configService: ConfigService) {
    this.redis = this.createRedisClient();
    this.subscriber = this.createRedisClient();
    this.TOKEN_EXPIRY = Number(this.configService.get('TOKEN_EXPIRY'));
    this.KEEP_ALIVE_EXPIRY = Number(
      this.configService.get('KEEP_ALIVE_EXPIRY'),
    );
  }

  /** Initialize the service (Subscribe to Redis events) */
  async onModuleInit() {
    try {
      await this.subscribeToTokenExpiry();
      this.logger.log('✅ TokenService initialized successfully.');
    } catch (error) {
      this.logger.error('❌ Error initializing TokenService:', error);
    }
  }

  /** Clean up resources when module is destroyed */
  async onModuleDestroy() {
    this.redis.disconnect();
    this.subscriber.disconnect();
    this.logger.log('ℹ️ Redis connections closed.');
  }

  /** Create a Redis client */
  private createRedisClient(): Redis {
    return new Redis({
      host: this.configService.get('REDIS_HOST'),
      port: Number(this.configService.get('REDIS_PORT')),
      password: this.configService.get('REDIS_PASSWORD') || undefined,
      tls: this.configService.get('REDIS_TLS') === 'true' ? {} : undefined,
      retryStrategy: (times) => Math.min(times * 50, 2000), // Retry logic
    });
  }

  /** Subscribe to Redis key expiry events */
  private async subscribeToTokenExpiry() {
    try {
      await this.subscriber.subscribe('__keyevent@0__:expired');
      this.subscriber.on('message', async (channel, message) => {
        if (
          channel === '__keyevent@0__:expired' &&
          message.startsWith('token:')
        ) {
          await this.handleExpiredToken(message.replace('token:', ''));
        }
      });
      this.logger.log('🔄 Subscribed to Redis key expiration events.');
    } catch (error) {
      this.logger.error('❌ Failed to subscribe to Redis events:', error);
    }
  }

  /** Handle expired tokens */
  private async handleExpiredToken(token: string) {
    try {
      const isAssigned = await this.redis.sismember('assigned_tokens', token);

      if (isAssigned) {
        this.logger.warn(
          `⚠️ Assigned token expired: ${token}, moving back to available pool.`,
        );
        await this.redis.sadd('available_tokens', token);
        await this.redis.set(`token:${token}`, 'free', 'EX', this.TOKEN_EXPIRY);
        await this.redis.srem('assigned_tokens', token);
      } else {
        this.logger.log(
          `🗑️ Unassigned token expired: ${token}, deleting permanently.`,
        );
        await this.redis.srem('available_tokens', token);
      }
    } catch (error) {
      this.logger.error(`❌ Error handling expired token ${token}:`, error);
    }
  }

  /** 🎟️ Create multiple tokens */
  async createMultipleTokens(count: number): Promise<void> {
    try {
      for (let i = 0; i < count; i++) {
        const token = `${uuidv4().split('-')[0]}-${Date.now()}`;
        await this.redis.set(`token:${token}`, 'free', 'EX', this.TOKEN_EXPIRY);
        await this.redis.sadd('available_tokens', token);
      }
      this.logger.log(`✅ Created ${count} tokens.`);
    } catch (error) {
      this.logger.error('❌ Error creating tokens:', error);
    }
  }

  /** 🎮 Assign a token */
  async assignToken(): Promise<string | false> {
    try {
      const token = await this.redis.spop('available_tokens');
      if (!token) return false;

      await this.redis.set(
        `token:${token}`,
        'assigned',
        'EX',
        this.KEEP_ALIVE_EXPIRY,
      );
      await this.redis.sadd('assigned_tokens', token);
      return token;
    } catch (error) {
      this.logger.error('❌ Error assigning token:', error);
      return false;
    }
  }

  /** 📜 Get all assigned tokens */
  async getAssignedTokens(): Promise<{ token: string; expiry: number }[]> {
    try {
      const assignedTokens = await this.redis.smembers('assigned_tokens');
      return Promise.all(
        assignedTokens.map(async (token) => ({
          token,
          expiry: (await this.redis.ttl(`token:${token}`)) * 1000 + Date.now(),
        })),
      );
    } catch (error) {
      this.logger.error('❌ Error fetching assigned tokens:', error);
      return [];
    }
  }

  /** 📜 Get all tokens */
  async getAllTokens(): Promise<
    { token: string; status: string; expiry: number }[]
  > {
    try {
      const keys = await this.redis.keys('token:*');
      return Promise.all(
        keys.map(async (key) => ({
          token: key.replace('token:', ''),
          status: await this.redis.get(key),
          expiry: (await this.redis.ttl(key)) * 1000 + Date.now(),
        })),
      );
    } catch (error) {
      this.logger.error('❌ Error fetching all tokens:', error);
      return [];
    }
  }

  /** 🔓 Free a token */
  async freeToken(token: string): Promise<boolean> {
    try {
      const key = `token:${token}`;
      const isAssigned = await this.redis.sismember('assigned_tokens', token);

      if (!isAssigned) return false;

      await this.redis.set(key, 'free', 'EX', this.TOKEN_EXPIRY);
      await this.redis.sadd('available_tokens', token);
      await this.redis.srem('assigned_tokens', token);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error freeing token ${token}:`, error);
      return false;
    }
  }

  /** ❌ Delete a token */
  async deleteToken(token: string): Promise<boolean> {
    try {
      const key = `token:${token}`;
      const isTokenExists = await this.redis.exists(key);
      if (!isTokenExists) return false;

      await this.redis.del(key);
      await this.redis.srem('assigned_tokens', token);
      await this.redis.srem('available_tokens', token);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error deleting token ${token}:`, error);
      return false;
    }
  }

  /** 🛡️ Keep a token alive */
  async keepAlive(token: string): Promise<boolean> {
    try {
      const key = `token:${token}`;
      const isTokenExists = await this.redis.exists(key);
      if (isTokenExists) {
        const isAssigned = await this.redis.sismember('assigned_tokens', token);
        if (isAssigned) await this.redis.expire(key, this.KEEP_ALIVE_EXPIRY);
        else await this.redis.expire(key, this.TOKEN_EXPIRY);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`❌ Error keeping token ${token} alive:`, error);
      return false;
    }
  }
}
