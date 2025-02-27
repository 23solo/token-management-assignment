import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class TokenService {
  private redis: Redis;
  private TOKEN_EXPIRY: number;
  private KEEP_ALIVE_EXPIRY: number;

  constructor(private readonly configService: ConfigService) {
    // Redis on localhost
    this.redis = new Redis({
      host: this.configService.get('REDIS_HOST'),
      port: Number(this.configService.get('REDIS_PORT')),
    });

    // Connect to redis server
    // this.redis = new Redis({
    //   host: this.configService.get('REDIS_HOST'),
    //   port: Number(this.configService.get('REDIS_PORT')),
    //   password: this.configService.get('REDIS_PASSWORD'),
    //   tls: this.configService.get('REDIS_TLS') === 'true' ? {} : undefined,
    // });

    this.KEEP_ALIVE_EXPIRY = Number(
      this.configService.get('KEEP_ALIVE_EXPIRY'),
    );
    this.TOKEN_EXPIRY = Number(this.configService.get('TOKEN_EXPIRY'));

    // Subscribe to Redis expired key event
    const subscriber = new Redis({
      host: this.configService.get('REDIS_HOST'),
      port: Number(this.configService.get('REDIS_PORT')),
    });

    subscriber.subscribe('__keyevent@0__:expired', (err) => {
      if (err) {
        console.error('Redis subscription error:', err);
      }
    });

    subscriber.on('message', async (channel, message) => {
      if (
        channel === '__keyevent@0__:expired' &&
        message.startsWith('token:')
      ) {
        const token = message.replace('token:', '');

        // Check if the token was assigned before expiring
        const isAssigned = await this.redis.sismember('assigned_tokens', token);

        if (isAssigned) {
          console.log(
            `Assigned token expired: ${token}, adding back to available pool`,
          );

          await this.redis.sadd('available_tokens', token);
          await this.redis.set(
            `token:${token}`,
            'free',
            'EX',
            this.TOKEN_EXPIRY,
          );
          // Remove from assigned set since it's back in available pool
          await this.redis.srem('assigned_tokens', token);
        } else {
          await this.redis.srem('available_tokens', token);
          console.log(
            `Unassigned token expired: ${token}, deleting permanently`,
          );
        }
      }
    });
  }

  /** 🎟️ Create multiple tokens */
  async createMultipleTokens(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const token = `token-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

      // Store token with status
      await this.redis.set(`token:${token}`, 'free', 'EX', this.TOKEN_EXPIRY);

      // Add to available set
      await this.redis.sadd('available_tokens', token);
    }
  }

  /** 🎮 Assign a token (O(1)) */
  async assignToken(): Promise<string | false> {
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
  }

  async getAssignedTokens(): Promise<{ token: string; expiry: number }[]> {
    const assignedTokens = await this.redis.smembers('assigned_tokens');
    const tokens = await Promise.all(
      assignedTokens.map(async (token) => {
        const ttl = await this.redis.ttl(`token:${token}`);
        return {
          token,
          expiry: ttl > 0 ? Date.now() + ttl * 1000 : 0,
        };
      }),
    );
    return tokens;
  }

  async getAllTokens(): Promise<
    { token: string; status: string; expiry: number }[]
  > {
    const keys = await this.redis.keys('token:*');
    const tokens = await Promise.all(
      keys.map(async (key) => {
        const status = await this.redis.get(key);
        const ttl = await this.redis.ttl(key);
        return {
          token: key.replace('token:', ''),
          status,
          expiry: Date.now() + ttl * 1000,
        };
      }),
    );
    return tokens;
  }

  /** 🔓 Free a token */
  async freeToken(token: string): Promise<boolean> {
    const key = `token:${token}`;
    const isTokenExists = await this.redis.exists(key);
    const isAssigned = await this.redis.sismember('assigned_tokens', token); // Use SISMEMBER if stored as a Set

    if (!isTokenExists || !isAssigned) return false;

    // Reset the expiration to 5 minutes (300 seconds)
    await this.redis.set(key, 'free', 'EX', this.TOKEN_EXPIRY);
    await this.redis.sadd('available_tokens', token);
    await this.redis.srem('assigned_tokens', token);
    return true;
  }

  /** ❌ Delete a token */
  async deleteToken(token: string): Promise<boolean> {
    const key = `token:${token}`;
    const isTokenExists = await this.redis.exists(key);
    if (isTokenExists) {
      await this.redis.del(key);
      const isAssigned = await this.redis.sismember('assigned_tokens', token);
      if (isAssigned) await this.redis.srem('assigned_tokens', token);
      const isAvailable = await this.redis.sismember('available_tokens', token);
      if (isAvailable) await this.redis.srem('available_tokens', token);
      return true;
    }
    return false;
  }

  /** 🛡️ Keep a token alive */
  async keepAlive(token: string): Promise<boolean> {
    const key = `token:${token}`;

    // Check if the token exists in Redis and is in the assigned_tokens set
    const isTokenExists = await this.redis.exists(key);
    const isAssigned = await this.redis.sismember('assigned_tokens', token); // Use SISMEMBER if stored as a Set

    if (!isTokenExists || !isAssigned) return false;

    await this.redis.expire(key, this.KEEP_ALIVE_EXPIRY); // Extend expiry by 1 minute
    return true;
  }
}
