import { createContext } from 'react'
import type {
  LoginRequest,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  RegisterRequest,
  UserDto,
} from '@web-app-demo/contracts'

import type { ApiClient } from './api'

export type AuthContextValue = {
  user: UserDto | null
  isBootstrapping: boolean
  isAuthenticated: boolean
  api: ApiClient
  register: (input: RegisterRequest) => Promise<void>
  login: (input: LoginRequest) => Promise<void>
  requestPasswordReset: (input: PasswordResetRequest) => Promise<void>
  resetPassword: (input: PasswordResetConfirmRequest) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
