export const Role = {
  EMPLOYEE: 'EMPLOYEE',
  ADMIN: 'ADMIN',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export type AttendanceType = 'CHECK_IN' | 'CHECK_OUT';
export type AttendanceStatus = 'PENDING' | 'VALID' | 'REJECTED' | 'MANUAL' | 'DUPLICATE';
