declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: {
        userId: string;
        role: "MANAGER" | "SUPERVISOR";
        sessionId: string;
        deviceId: string;
        mustChangePassword: boolean;
      };
    }
  }
}

export {};
