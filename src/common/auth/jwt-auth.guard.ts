import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { SetMetadata } from '@nestjs/common';
import { Observable } from 'rxjs';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    constructor(private reflector: Reflector) {
        super();
    }

    canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);

        if (isPublic) {
            return true;
        }

        return super.canActivate(context);
    }

    handleRequest(err: any, user: any, info: any, context: ExecutionContext) { 
        console.log('handleRequest called'); 
        console.log('Error:', err); 
        console.log('User:', user); 
        console.log('Info:', info); 
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ context.getHandler(), context.getClass(), ]); 
        if (isPublic) { return user || null; } 
        // For protected routes, throw error if authentication fails
         if (err || !user) { 
            console.log('Authentication failed, throwing UnauthorizedException'); 
            throw err || new UnauthorizedException('JWT authentication failed'); 
        } 
        console.log('Authentication successful'); return user; 
    }
}
