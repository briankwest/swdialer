import axios from 'axios';
import type { TokenData, CallData } from '../types';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const authAPI = {
  async getToken(subscriberId?: string): Promise<TokenData> {
    const response = await api.post<{ success: boolean; data: TokenData }>('/auth/token', {
      subscriber_id: subscriberId,
      reference: 'swdialer',  // Required reference field
    });
    if (!response.data.success) {
      throw new Error('Failed to get token');
    }
    return response.data.data;
  },

  async refreshToken(oldToken?: string): Promise<TokenData> {
    const response = await api.post<{ success: boolean; data: TokenData }>('/auth/refresh', {
      token: oldToken,
      reference: 'swdialer',  // Required reference field
    });
    if (!response.data.success) {
      throw new Error('Failed to refresh token');
    }
    return response.data.data;
  },
};

export const callsAPI = {
  async initiateCall(toNumber: string): Promise<CallData> {
    const response = await api.post<{ success: boolean; data: CallData }>('/calls/dial', {
      to: toNumber,
    });
    if (!response.data.success) {
      throw new Error('Failed to initiate call');
    }
    return response.data.data;
  },

  async endCall(callId: string): Promise<CallData> {
    const response = await api.post<{ success: boolean; data: CallData }>(`/calls/end/${callId}`);
    if (!response.data.success) {
      throw new Error('Failed to end call');
    }
    return response.data.data;
  },

  async getCallStatus(callId: string): Promise<CallData> {
    const response = await api.get<{ success: boolean; data: CallData }>(`/calls/status/${callId}`);
    if (!response.data.success) {
      throw new Error('Failed to get call status');
    }
    return response.data.data;
  },

  async getCallHistory(limit = 50): Promise<CallData[]> {
    const response = await api.get<{ success: boolean; data: CallData[] }>('/calls/history', {
      params: { limit },
    });
    if (!response.data.success) {
      throw new Error('Failed to get call history');
    }
    return response.data.data;
  },
};