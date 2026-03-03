import { SignalWire } from '@signalwire/js';
import type { Call } from '@signalwire/js';
import type { Subscription } from 'rxjs';
import type { TokenData } from '../types';
import { authAPI } from './api';
import { toneService } from './tones';

class SignalWireService {
  private client: InstanceType<typeof SignalWire> | null = null;
  private currentCall: Call | null = null;
  private pendingCall: Call | null = null;
  private currentToken: TokenData | null = null;
  private wasIncomingCall: boolean = false;
  private isInitialized: boolean = false;
  private isInitializing: boolean = false;

  // RxJS subscriptions
  private incomingCallSub: Subscription | null = null;
  private callStatusSub: Subscription | null = null;
  private remoteStreamSub: Subscription | null = null;
  private errorSub: Subscription | null = null;

  // Callbacks
  private onIncomingCall: ((remoteNumber: string) => void) | null = null;
  private onCallEnded: ((wasIncoming: boolean) => void) | null = null;

  async initialize(
    onIncomingCall?: (remoteNumber: string) => void,
    onCallEnded?: (wasIncoming: boolean) => void
  ) {
    if (this.isInitializing || this.isInitialized) {
      console.log('SignalWire initialization already in progress or completed, skipping...');
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return true;
    }

    this.isInitializing = true;
    console.log('Starting SignalWire initialization...');

    try {
      this.onIncomingCall = onIncomingCall || null;
      this.onCallEnded = onCallEnded || null;

      // Create credential provider with automatic refresh
      const credentialProvider = {
        authenticate: async () => {
          const tokenData = await authAPI.getToken();
          this.currentToken = tokenData;
          return {
            token: tokenData.token,
            expiry_at: Date.parse(tokenData.expires_at),
          };
        },
        refresh: async () => {
          const tokenData = await authAPI.refreshToken(this.currentToken?.token);
          this.currentToken = tokenData;
          return {
            token: tokenData.token,
            expiry_at: Date.parse(tokenData.expires_at),
          };
        },
      };

      // Initialize the v4 client
      this.client = new SignalWire(credentialProvider);

      // Subscribe to errors
      this.errorSub = this.client.errors$.subscribe((error) => {
        console.error('SignalWire error:', error);
      });

      // Register for incoming calls
      await this.client.register();
      console.log('Client registered and ready for incoming calls');

      // Subscribe to incoming calls
      this.incomingCallSub = this.client.session.incomingCalls$.subscribe((calls) => {
        const ringingCall = calls.find(c => c.status === 'ringing' || c.status === 'new');
        if (!ringingCall) return;

        // Auto-reject if already in a call
        if (this.currentCall) {
          console.log('Already in a call - auto-rejecting incoming call');
          ringingCall.reject();
          return;
        }

        // Don't re-notify for the same pending call
        if (this.pendingCall && this.pendingCall.id === ringingCall.id) return;

        this.pendingCall = ringingCall;

        // fromName/from exist on WebRTCCall at runtime but not on the Call type
        const callObj = ringingCall as any;
        const rawName = callObj.fromName;
        const callerId = (rawName && rawName !== '_undef_') ? rawName : callObj.from || 'Unknown';
        console.log('Incoming call from:', callerId);

        toneService.playIncomingCallTone();
        if (this.onIncomingCall) this.onIncomingCall(callerId);

        // Watch for the caller hanging up before we answer
        const cleanupCanceled = () => {
          console.log('Incoming call canceled by caller');
          toneService.stopIncomingCallTone();
          if (this.pendingCall?.id === ringingCall.id) {
            this.pendingCall = null;
            this.handleCallEnded();
          }
          pendingSub.unsubscribe();
        };

        const pendingSub = ringingCall.status$.subscribe({
          next: (status) => {
            if (status === 'disconnected' || status === 'failed' || status === 'destroyed') {
              cleanupCanceled();
            }
          },
          // The SDK completes all subjects on destroy() without emitting a
          // terminal status, so we must also handle completion.
          complete: () => {
            if (this.pendingCall?.id === ringingCall.id) {
              cleanupCanceled();
            }
          },
        });
      });

      this.isInitialized = true;
      this.isInitializing = false;
      console.log('SignalWire service fully initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize SignalWire:', error);
      this.isInitializing = false;
      throw error;
    }
  }

  private setupCallSubscriptions(call: Call) {
    this.cleanupCallSubscriptions();

    // Subscribe to call status changes
    this.callStatusSub = call.status$.subscribe((status) => {
      console.log('Call status:', status);
      if (status === 'disconnected' || status === 'failed') {
        toneService.playDisconnectTone();
        // Only clean up if this is still the active call (endCall may have already cleared it)
        if (this.currentCall === call) {
          this.handleCallEnded();
        }
      }
    });

    // Subscribe to remote stream for audio playback
    this.remoteStreamSub = call.remoteStream$.subscribe((stream) => {
      if (stream) {
        const tracks = stream.getAudioTracks();
        console.log('Remote stream received:', {
          id: stream.id,
          active: stream.active,
          audioTracks: tracks.length,
          trackDetails: tracks.map(t => ({
            enabled: t.enabled,
            readyState: t.readyState,
            muted: t.muted,
          })),
        });

        let audioEl = document.getElementById('sw-remote-audio') as HTMLAudioElement;
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.id = 'sw-remote-audio';
          audioEl.autoplay = true;
          document.body.appendChild(audioEl);
        }
        audioEl.srcObject = stream;
        audioEl.volume = 1.0;

        // Explicitly call play() — autoplay attribute alone can be blocked
        audioEl.play().catch(err => {
          console.error('Remote audio play() failed:', err);
        });
      } else {
        console.log('Remote stream cleared (null)');
      }
    });
  }

  private cleanupCallSubscriptions() {
    this.callStatusSub?.unsubscribe();
    this.callStatusSub = null;
    this.remoteStreamSub?.unsubscribe();
    this.remoteStreamSub = null;
  }

  async makeCall(phoneNumber: string): Promise<any> {
    if (!this.client) {
      throw new Error('SignalWire client not initialized');
    }

    try {
      // Format phone number
      let formattedNumber = phoneNumber;
      if (!formattedNumber.startsWith('+')) {
        if (formattedNumber.length === 10) {
          formattedNumber = '+1' + formattedNumber;
        } else if (formattedNumber.length === 11 && formattedNumber.startsWith('1')) {
          formattedNumber = '+' + formattedNumber;
        } else {
          formattedNumber = '+' + formattedNumber;
        }
      }
      console.log('Dialing:', formattedNumber);

      const call = await this.client.dial(formattedNumber, {
        audio: true,
        video: false,
      });

      this.currentCall = call;
      this.wasIncomingCall = false;
      this.setupCallSubscriptions(call);

      console.log('Call initiated successfully');
      return call;
    } catch (error) {
      console.error('Failed to make call:', error);
      throw error;
    }
  }

  async endCall() {
    const call = this.currentCall;
    if (!call) return;

    // Eagerly clean up state so incoming calls aren't blocked by stale references.
    // Don't wait for the SDK's status$ to emit 'disconnected' — it may be delayed
    // or never fire if the call was still in ICE negotiation.
    toneService.playDisconnectTone();
    this.handleCallEnded();

    // Best-effort hangup signal to the server
    try {
      await call.hangup();
    } catch (error) {
      console.debug('Hangup during endCall (ignored):', error);
    }
  }

  async answerCall() {
    if (!this.pendingCall) {
      throw new Error('No incoming call to answer');
    }

    if (this.currentCall) {
      console.warn('Call already in progress, ignoring answer');
      return;
    }

    try {
      console.log('Answering incoming call...');
      toneService.stopIncomingCallTone();

      const call = this.pendingCall;
      this.pendingCall = null;
      this.currentCall = call;
      this.wasIncomingCall = true;

      call.answer();
      this.setupCallSubscriptions(call);

      console.log('Call answered successfully');
    } catch (error) {
      console.error('Failed to answer call:', error);
      this.pendingCall = null;
      throw error;
    }
  }

  async rejectCall() {
    if (!this.pendingCall) {
      throw new Error('No incoming call to reject');
    }

    try {
      console.log('Rejecting incoming call...');
      toneService.stopIncomingCallTone();
      this.pendingCall.reject();
      this.pendingCall = null;
      console.log('Call rejected');
    } catch (error) {
      console.error('Failed to reject call:', error);
      this.pendingCall = null;
      throw error;
    }
  }

  async toggleMute(muted: boolean) {
    if (!this.currentCall) {
      console.warn('No active call to mute/unmute');
      return;
    }

    try {
      const self = this.currentCall.self;
      if (!self) {
        console.warn('Self participant not available yet');
        return;
      }
      if (muted) {
        await self.mute();
      } else {
        await self.unmute();
      }
      console.log(`Audio ${muted ? 'muted' : 'unmuted'}`);
    } catch (error) {
      console.error('Error toggling mute:', error);
    }
  }

  async toggleSpeaker(speakerOn: boolean) {
    console.log('Speaker toggle:', speakerOn);
  }

  async sendDTMF(digit: string) {
    if (this.currentCall) {
      await this.currentCall.sendDigits(digit);
    }
  }

  private handleCallEnded() {
    console.log('handleCallEnded - cleaning up');
    const wasIncoming = this.wasIncomingCall;

    this.cleanupCallSubscriptions();
    this.currentCall = null;
    this.pendingCall = null;
    this.wasIncomingCall = false;

    // Clean up audio element
    const audioEl = document.getElementById('sw-remote-audio') as HTMLAudioElement;
    if (audioEl) {
      audioEl.srcObject = null;
    }

    if (this.onCallEnded) {
      console.log('Notifying UI of call end, wasIncoming:', wasIncoming);
      this.onCallEnded(wasIncoming);
    }
  }

  disconnect() {
    if (!this.client) {
      console.log('Disconnect called but no client exists - ignoring');
      return;
    }

    console.log('SignalWire service disconnecting...');

    this.cleanupCallSubscriptions();
    this.incomingCallSub?.unsubscribe();
    this.incomingCallSub = null;
    this.errorSub?.unsubscribe();
    this.errorSub = null;

    if (this.currentCall) {
      this.currentCall.hangup().catch((error: any) => {
        console.debug('Hangup error during disconnect (ignored):', error.message);
      });
      this.currentCall = null;
    }

    this.pendingCall = null;

    this.client.unregister().catch((error: any) => {
      console.debug('Unregister error (ignored):', error.message);
    });

    this.client.disconnect().catch((error: any) => {
      console.debug('Disconnect error (ignored):', error.message);
    });

    this.client = null;
  }
}

export const signalWireService = new SignalWireService();
