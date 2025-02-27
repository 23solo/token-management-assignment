import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TokenService } from './token.service';
import { TokenController } from './token.controller';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [TokenController],
  providers: [TokenService],
})
export class TokenModule {}
