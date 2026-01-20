import { UserRole } from './auth.model';

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role: UserRole;
  createdAt: string;
  teacherProfile?: TeacherProfileDto;
  studentProfile?: StudentProfileDto;
}

export interface TeacherProfileDto {
  id: string;
  bio?: string;
  isPublic: boolean;
  instruments: string[];
  specializations: string[];
  hourlyRate?: number;
  hasStripeConnected: boolean;
}

export interface StudentProfileDto {
  id: string;
  currentLevel: number;
  totalXP: number;
  currentStreak: number;
  instruments: string[];
}

export interface UpdateUserRequest {
  displayName?: string;
  avatarUrl?: string;
}
