import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  NotFoundException,
  BadRequestException,
  Body,
} from '@nestjs/common';
import { TokenService } from './token.service';

@Controller('token')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  /** 🎮 Generate tokens */
  @Post('create')
  async createMultipleTokens(@Body('count') count: number) {
    if (!count || count <= 0) {
      throw new BadRequestException('Invalid token count');
    }
    await this.tokenService.createMultipleTokens(count);
    return { message: `${count} tokens created successfully` };
  }

  /** 🎮 Return All tokens */
  @Get('all')
  async getAllTokens() {
    return this.tokenService.getAllTokens();
  }

  /** 🎮 Return Assigned tokens */
  @Get('assigned')
  async getAssignedTokens() {
    return this.tokenService.getAssignedTokens();
  }

  /** 🎮 Assign a token */
  @Post('assign')
  async assignToken(): Promise<{ token: string } | NotFoundException> {
    const token = await this.tokenService.assignToken();
    if (!token) throw new NotFoundException('No available tokens');
    return { token };
  }

  /** 🔓 Free a token */
  @Post('free/:token')
  async freeToken(
    @Param('token') token: string,
  ): Promise<{ success: boolean }> {
    const success = await this.tokenService.freeToken(token);
    if (!success) throw new NotFoundException('Invalid / Expired Token');
    return { success };
  }

  /** ❌ Delete a token */
  @Delete('delete/:token')
  async deleteToken(
    @Param('token') token: string,
  ): Promise<{ success: boolean }> {
    const success = await this.tokenService.deleteToken(token);
    if (!success) throw new NotFoundException('Invalid / Expired Token');
    return { success };
  }

  /** 🛡️ Keep token alive */
  @Post('keep-alive/:token')
  async keepAlive(
    @Param('token') token: string,
  ): Promise<{ success: boolean }> {
    const success = await this.tokenService.keepAlive(token);
    if (!success) throw new NotFoundException('Invalid / Expired Token');
    return { success };
  }
}
