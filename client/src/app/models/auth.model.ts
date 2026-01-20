import { UserDto } from './user.model';

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  invitationCode?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: UserDto;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export enum UserRole {
  Student = 0,
  Teacher = 1,
  Admin = 2
}
