import { SignalWire } from '@signalwire/js';
import type { TokenData } from '../types';
import { authAPI } from './api';
import { toneService } from './tones';

class SignalWireService {
  private client: any = null;
  private currentCall: any = null;
  private currentInvite: any = null;  // Store invite separately from active call
  private currentToken: TokenData | null = null;
  private tokenRefreshTimer: NodeJS.Timeout | null = null;
  private onIncomingCall: ((remoteNumber: string) => void) | null = null;
  private onCallEnded: ((wasIncoming: boolean) => void) | null = null;  // Callback for when call ends
  private isOnline: boolean = false;
  private hasSetupListeners: boolean = false;
  private wasIncomingCall: boolean = false;  // Track if current call was incoming
  private isInitialized: boolean = false;  // Track if we've already initialized
  private isInitializing: boolean = false;  // Track if initialization is in progress

  async initialize(
    onIncomingCall?: (remoteNumber: string) => void,
    onCallEnded?: (wasIncoming: boolean) => void
  ) {
    // Check both flags to prevent double initialization
    if (this.isInitializing || this.isInitialized) {
      console.log('⚠️ SignalWire initialization already in progress or completed, skipping...');
      // Wait for initialization to complete if it's in progress
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return true;
    }

    // Set the flag IMMEDIATELY to prevent race conditions
    this.isInitializing = true;
    console.log('🔐 Starting SignalWire initialization...');

    try {
      this.onIncomingCall = onIncomingCall || null;
      this.onCallEnded = onCallEnded || null;

      // Get initial token
      this.currentToken = await authAPI.getToken();

      // Initialize SignalWire Fabric client with debugging enabled
      console.log('🔐 Initializing SignalWire with token:', {
        token: this.currentToken.token.substring(0, 20) + '...',
        host: this.currentToken.space_name,
        expires_in: this.currentToken.expires_in
      });

      this.client = await SignalWire({
        token: this.currentToken.token,
        host: this.currentToken.space_name,
        // pubChannelHost: 'puc.swire.io',  // Custom PubChannel host - not available in current SDK type definitions
        logLevel: 'debug',  // Enable debug logging
	connectionPoolSize: 1,
	iceCandidatePoolSize: 10,
        debug: {
          logWsTraffic: true,  // Log all WebSocket traffic
        },
      });

      console.log('✅ SignalWire client initialized');
      console.log('Client object:', this.client);
      console.log('Available client methods:', Object.keys(this.client || {}));

      // IMMEDIATELY go online to receive incoming calls
      await this.registerForIncomingCalls();
      console.log('✅ Client is ONLINE and ready to receive calls');

      // Set up token refresh
      this.scheduleTokenRefresh();

      // Set up event listeners if they exist
      if (this.client.__wsClient) {
        this.setupEventListeners();
      }

      // Mark as initialized and clear initializing flag
      this.isInitialized = true;
      this.isInitializing = false;
      console.log('✅ SignalWire service fully initialized');

      return true;
    } catch (error) {
      console.error('Failed to initialize SignalWire:', error);
      // Clear the initializing flag on error
      this.isInitializing = false;
      throw error;
    }
  }

  private async registerForIncomingCalls() {
    if (!this.client) {
      console.error('Cannot go online - no client instance');
      return;
    }

    // Don't go online again if already online
    if (this.isOnline) {
      console.log('✅ Already online, skipping registration');
      return;
    }

    try {
      console.log('🔄 Going online to receive incoming calls...');
      // Use the online method to register for incoming calls
      await this.client.online({
        incomingCallHandlers: {
          // IMPORTANT: Handler should NOT be async and should return nothing
          // This matches the official example pattern
          all: (notification: any) => {
            console.log('📲 Incoming call notification received:', notification);

            // According to SDK, notification has an 'invite' object with details, accept(), and reject()
            if (notification.invite) {
              // Store the invite separately - NOT as currentCall
              this.currentInvite = notification.invite;

              // Extract caller info from the details
              const details = notification.invite.details || {};
              const callerId = details.caller_id_number ||
                              details.caller_id_name ||
                              details.from ||
                              'Unknown';

              console.log('📢 Incoming call from:', callerId);
              console.log('Invite details:', details);

              // Play incoming call alert tone
              toneService.playIncomingCallTone();

              if (this.onIncomingCall) {
                this.onIncomingCall(callerId);
              }
            } else {
              console.warn('⚠️ Unexpected notification format:', notification);
            }

            // Return nothing - handler should not return anything
            return;
          }
        }
      });

      this.isOnline = true;
      console.log('🟢 Successfully registered for incoming calls - client is ONLINE');
    } catch (error) {
      console.error('❌ CRITICAL: Failed to go online for incoming calls:', error);
      this.isOnline = false;
      // Retry going online after 2 seconds
      setTimeout(() => this.registerForIncomingCalls(), 2000);
    }
  }

  private setupEventListeners() {
    if (!this.client || !this.client.__wsClient) return;

    // Don't setup listeners again if already set up
    if (this.hasSetupListeners) {
      console.log('✓ Event listeners already set up, skipping');
      return;
    }

    const wsClient = this.client.__wsClient;
    this.hasSetupListeners = true;

    // Log all events for debugging
    console.log('Setting up WebSocket event listeners...');

    // Listen for incoming calls if the method exists
    if (wsClient.on) {
      wsClient.on('call.received', (call: any) => {
        console.log('🔔 Incoming call received:', call);

        // Play incoming call ringtone
        toneService.playIncomingCallTone();

        if (this.onIncomingCall) {
          const remoteNumber = call.from || 'Unknown';
          this.onIncomingCall(remoteNumber);
          this.currentCall = call;
        }
      });

      // Listen for all WebSocket events for debugging
      const events = [
        'message',
        'error',
        'close',
        'open',
        'session.connected',
        'session.disconnected',
        'session.reconnecting',
        'session.auth_error',
        'session.expiring',
        'session.idle',
        'call.state',
        'call.created',
        'call.answered',
        'call.ended',
        'call.updated',
        'verto.bye',  // Remote hangup event
      ];

      events.forEach(eventName => {
        if (wsClient.on) {
          wsClient.on(eventName, (data: any) => {
            console.log(`📡 WS Event [${eventName}]:`, data);

            // Special handling for verto.bye - remote party hung up
            if (eventName === 'verto.bye') {
              console.log('🔴 Remote party hung up (verto.bye)');

              // Only play disconnect tone if we're in an active call (not ringing)
              // Check if there's an actual call in progress
              if (this.currentCall && this.currentCall.state === 'active') {
                toneService.playDisconnectTone();
              }

              this.handleCallEnded();
            }

            // Special handling for call.state - check if call is ending/ended
            if (eventName === 'call.state' && data) {
              // Check nested params structure (from your logs)
              const callState = data.params?.call_state || data.call_state;
              const direction = data.params?.direction || data.direction;
              const callId = data.params?.call_id || data.call_id;

              console.log(`📞 Call state change: ${callState}, direction: ${direction}, callId: ${callId}`);

              // For now, only handle call.state events if we actually have an active call or invite
              // This prevents handling stray events from other calls
              if (!this.currentCall && !this.currentInvite) {
                console.log('📞 Ignoring call.state - no active call or invite');
                return;
              }

              // Handle canceled inbound calls (caller hung up before answer)
              if ((callState === 'ending' || callState === 'ended')) {
                console.log('🔴 Call ending/ended - resetting UI');

                // Check if this is an unanswered inbound call
                const answerTime = data.params?.answer_time || data.answer_time;
                const endReason = data.params?.end_reason || data.end_reason;
                const endSource = data.params?.end_source || data.end_source;

                if (answerTime === 0 || !answerTime) {
                  console.log('📵 Unanswered call - caller hung up');
                  // Stop ringtone if it's playing (for unanswered incoming calls)
                  toneService.stopIncomingCallTone();
                  // Don't play disconnect tone for unanswered calls
                } else {
                  // This was an answered call that ended
                  // Only play disconnect tone if remote party hung up (not local hangup)
                  // end_reason 'cancel' usually means remote hangup, 'hangup' means local
                  if (endReason === 'cancel' || endSource !== 'local') {
                    console.log('📵 Remote party ended the call - playing disconnect tone');
                    toneService.playDisconnectTone();
                  }
                }

                // Reset the UI
                this.handleCallEnded();

                // Clear any pending invites
                if (this.currentInvite) {
                  this.currentInvite = null;
                }
              }
            }
          });
        }
      });

      // Listen for session events to detect disconnection
      if (wsClient.session) {
        wsClient.session.on('session.disconnected', () => {
          console.log('⚠️ Session disconnected - will reconnect');
          // Only reconnect if we don't have a client anymore
          if (!this.client) {
            this.reconnect();
          }
        });

        // Log all session events
        const sessionEvents = [
          'session.connected',
          'session.auth_error',
          'session.disconnecting',
          'session.disconnected',
          'session.expiring',
          'session.idle',
          'session.reconnecting',
          'session.unknown',
        ];

        sessionEvents.forEach(eventName => {
          wsClient.session.on(eventName, (data: any) => {
            console.log(`🔐 Session Event [${eventName}]:`, data || '');
          });
        });
      }
    }

    // If there's a raw WebSocket, log its events too
    if (wsClient._ws) {
      console.log('Raw WebSocket found, attaching listeners...');

      wsClient._ws.addEventListener('message', (event: any) => {
        console.log('📥 WS Raw Message:', event.data);
      });

      wsClient._ws.addEventListener('error', (event: any) => {
        console.log('❌ WS Raw Error:', event);
      });

      wsClient._ws.addEventListener('close', (event: any) => {
        console.log('🔴 WS Raw Close:', event.code, event.reason);
      });

      wsClient._ws.addEventListener('open', () => {
        console.log('🟢 WS Raw Open');
      });
    }
  }

  private scheduleTokenRefresh() {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }

    if (!this.currentToken) return;

    // Refresh at 80% of token lifetime
    const refreshIn = this.currentToken.expires_in * 0.8 * 1000;

    this.tokenRefreshTimer = setTimeout(async () => {
      await this.refreshToken();
    }, refreshIn);
  }

  private async refreshToken() {
    try {
      console.log('Refreshing SignalWire token...');

      const newToken = await authAPI.refreshToken(this.currentToken?.token);
      this.currentToken = newToken;

      // Use updateToken method to refresh without disconnecting
      if (this.client && this.client.updateToken) {
        await this.client.updateToken(newToken.token);
        console.log('✅ Token updated without disconnecting');
      } else {
        // Fallback to reconnect if updateToken is not available
        console.log('updateToken not available, reconnecting...');
        await this.reconnect();
      }

      console.log('Token refreshed successfully');

      // Schedule next refresh
      this.scheduleTokenRefresh();
    } catch (error) {
      console.error('Failed to refresh token:', error);
      // Retry after 5 seconds
      setTimeout(() => this.refreshToken(), 5000);
    }
  }

  private async reconnect() {
    try {
      console.log('Attempting to reconnect...');

      // Reset flags
      this.isOnline = false;
      this.hasSetupListeners = false;

      // Clear any existing call and invite
      this.currentCall = null;
      this.currentInvite = null;

      // Disconnect existing client safely
      if (this.client && typeof this.client.disconnect === 'function') {
        try {
          await this.client.disconnect();
        } catch (disconnectError) {
          console.debug('Error during reconnect disconnect:', disconnectError);
          // Continue with reconnection anyway
        }
        this.client = null;
      }

      // Reinitialize with new token and debugging
      if (this.currentToken) {
        this.client = await SignalWire({
          token: this.currentToken.token,
          host: this.currentToken.space_name,
          logLevel: 'debug',  // Enable debug logging
          debug: {
            logWsTraffic: true,  // Log all WebSocket traffic
          },
        });

        // IMMEDIATELY go online to receive incoming calls
        await this.registerForIncomingCalls();

        if (this.client.__wsClient) {
          this.setupEventListeners();
        }

        console.log('✅ Reconnected successfully - client is ONLINE');
      }
    } catch (error) {
      console.error('Reconnection failed:', error);
      // Retry after 5 seconds
      setTimeout(() => this.reconnect(), 5000);
    }
  }

  async makeCall(phoneNumber: string): Promise<any> {
    console.log('🔵 makeCall() called with:', phoneNumber);

    if (!this.client) {
      console.log('❌ Client not initialized, attempting to reinitialize...');
      // Try to reinitialize if we have a token
      if (this.currentToken) {
        await this.reconnect();
      }
      // Check again after reconnect attempt
      if (!this.client) {
        throw new Error('SignalWire client not initialized');
      }
    }

    console.log('✅ Client exists, preparing to dial...');
    console.log('Client object:', this.client);
    console.log('Client methods available:', Object.keys(this.client));

    try {
      // Create a dedicated container for SignalWire media elements
      // Don't use React's root element to avoid DOM conflicts
      let rootElement = document.getElementById('signalwire-media');
      if (!rootElement) {
        rootElement = document.createElement('div');
        rootElement.id = 'signalwire-media';
        rootElement.style.display = 'none';  // Hide since we're only doing audio
        document.body.appendChild(rootElement);
      } else {
        // Clear any existing content to avoid conflicts
        while (rootElement.firstChild) {
          rootElement.removeChild(rootElement.firstChild);
        }
      }
      console.log('📍 Root element for media:', rootElement);

      // Format the phone number (ensure it starts with +)
      let formattedNumber = phoneNumber;
      if (!formattedNumber.startsWith('+')) {
        // Assume US number if no country code
        if (formattedNumber.length === 10) {
          formattedNumber = '+1' + formattedNumber;
        } else if (formattedNumber.length === 11 && formattedNumber.startsWith('1')) {
          formattedNumber = '+' + formattedNumber;
        } else {
          formattedNumber = '+' + formattedNumber;
        }
      }
      console.log('📞 Formatted number:', formattedNumber);

      // Try different formats for PSTN dialing
      // Option 1: Direct phone number
      // Option 2: With /public/ prefix (resource address)
      const dialParams = {
        to: formattedNumber,  // Try direct first, may need /public/ prefix
        rootElement: rootElement,
	callerIdName: "Brian West",
	callerIdNumber: "+12068655443",
        audio: true,
        video: false,
      };

      console.log('⚠️ Note: If dial fails, may need to use resource address like /public/{number}');
      console.log('📤 Dial parameters:', dialParams);

      // Make the call using Fabric dial method
      console.log('🎯 Calling client.dial()...');
      let call;
      try {
        call = await this.client.dial(dialParams);
        console.log('🎉 client.dial() returned:', call);
        console.log('Call object type:', typeof call);
        console.log('Call object keys:', call ? Object.keys(call) : 'null');
      } catch (dialError: any) {
        console.error('❌ client.dial() threw an error:', dialError);
        console.error('Error type:', dialError?.constructor?.name);
        console.error('Error message:', dialError?.message);
        console.error('Error stack:', dialError?.stack);

        // Check if it's a format issue
        if (dialError?.message?.includes('address') || dialError?.message?.includes('format')) {
          console.error('🔄 Possible format issue. Phone numbers might need to be in resource address format.');
          console.error('Try formats like: /public/+19184249378 or /pstn/+19184249378');
        }

        throw dialError;
      }

      // Store the call object
      this.currentCall = call;
      this.wasIncomingCall = false;  // Mark this as an outgoing call

      // Set up event listeners
      if (call) {
        console.log('📡 Setting up call event listeners...');

        // Listen for ALL events on the call object
        const events = [
          'call.state', 'call.ended', 'destroy', 'error', 'answered', 'hangup',
          'state.update', 'member.joined', 'member.left', 'room.started', 'room.ended',
          'member.updated', 'layout.changed', 'call.received', 'call.answered'
        ];
        events.forEach(eventName => {
          if (call.on) {
            call.on(eventName, (data: any) => {
              console.log(`🔔 Call Event [${eventName}]:`, data);
            });
          }
        });

        // Check the current state of the call
        console.log('🔍 Checking call state after dial:');
        console.log('Call state:', call.state);
        console.log('Call active?:', call.active);
        console.log('Call id:', call.id || call.uuid);

        // Check if we need to explicitly start or join the call
        if (call.join && typeof call.join === 'function') {
          console.log('🎯 Attempting to join the call...');
          try {
            await call.join();
            console.log('✅ Joined the call');
          } catch (joinError) {
            console.error('❌ Failed to join call:', joinError);
          }
        }

        call.on('call.state', (state: any) => {
          console.log('📱 Call state change:', state);
        });

        call.on('call.ended', () => {
          console.log('📴 Call ended by remote party or network');
          this.handleCallEnded();
        });

        call.on('destroy', () => {
          console.log('💥 Call destroyed');
          this.handleCallEnded();
        });

        // Listen for hangup event
        call.on('hangup', (reason: any) => {
          console.log('📵 Call hung up:', reason);
          this.handleCallEnded();
        });
      } else {
        console.error('⚠️ Call object is null/undefined!');
      }

      console.log('✅ Call initiated successfully');
      console.log('📦 Full call object:', call);
      return call;
    } catch (error) {
      console.error('Failed to make call:', error);
      throw error;
    }
  }

  async endCall() {
    try {
      if (this.currentCall && this.currentCall.hangup) {
        await this.currentCall.hangup();
        // Don't null the currentCall here, let the event handler do it
      }
      console.log('Call ending...');
    } catch (error) {
      console.error('Failed to end call:', error);
      // Clear the call reference even if hangup fails
      this.currentCall = null;
    }
  }

  async answerCall() {
    if (!this.currentInvite) {
      console.error('❌ No incoming invite to answer');
      throw new Error('No incoming call to answer');
    }

    // Prevent double-answering
    if (this.currentCall) {
      console.warn('⚠️ Call already in progress, ignoring answer');
      return;
    }

    try {
      console.log('📢 Answering incoming call...');
      console.log('Invite object:', this.currentInvite);

      // Stop the ringtone since we're answering
      toneService.stopIncomingCallTone();

      // Store invite temporarily and clear it to prevent double-answer
      const invite = this.currentInvite;
      this.currentInvite = null;
      this.wasIncomingCall = true;  // Mark this as an incoming call

      // Use dedicated container for media elements
      let rootElement = document.getElementById('signalwire-media');
      if (!rootElement) {
        rootElement = document.createElement('div');
        rootElement.id = 'signalwire-media';
        rootElement.style.display = 'none';
        document.body.appendChild(rootElement);
      } else {
        // Clear any existing content to avoid conflicts
        while (rootElement.firstChild) {
          rootElement.removeChild(rootElement.firstChild);
        }
      }

      // Accept the invite - this returns the actual call object
      // The SDK internally calls answer() after accept()
      console.log('🎯 Calling invite.accept()...');
      const acceptedCall = await invite.accept({
        rootElement: rootElement,
        audio: true,
        video: false,
      });

      console.log('✅ Invite accepted, call object:', acceptedCall);
      console.log('Call type:', acceptedCall?.constructor?.name);
      console.log('Call id:', acceptedCall?.id || acceptedCall?.uuid);

      // Now store the actual call object
      this.currentCall = acceptedCall;

      // DO NOT call answer() again - the SDK already did it internally
      // Calling answer() again causes negotiation loops

      // Set up event listeners for the accepted call (matching official example)
      if (acceptedCall) {
        // Listen for call state changes (primary event per official example)
        acceptedCall.on('call.state', (params: any) => {
          console.log('📱 Call state changed:', params.call_state || params);

          // Handle call ended state
          if (params.call_state === 'ended') {
            console.log('📴 Call ended - call.state = ended');
            this.handleCallEnded();
          }
        });

        // Listen for member events (from official example)
        acceptedCall.on('member.joined', (params: any) => {
          console.log('👤 Member joined:', params);
        });

        acceptedCall.on('member.left', (params: any) => {
          console.log('👤 Member left:', params);
        });

        // Listen for stream events (from official example)
        acceptedCall.on('stream.started', (params: any) => {
          console.log('📡 Stream started:', params);
        });

        acceptedCall.on('stream.ended', (params: any) => {
          console.log('📡 Stream ended:', params);
        });

        // Keep our additional events for redundancy
        acceptedCall.on('destroy', () => {
          console.log('💥 Call destroyed');
          this.handleCallEnded();
        });

        // Listen for errors
        acceptedCall.on('error', (error: any) => {
          console.error('❌ Call error:', error);
        });
      }

      console.log('✅ Call answered successfully');
    } catch (error) {
      console.error('❌ Failed to answer call:', error);
      this.currentInvite = null;  // Clear invite on error
      throw error;
    }
  }

  async rejectCall() {
    if (!this.currentInvite) {
      throw new Error('No incoming call to reject');
    }

    try {
      console.log('🚫 Rejecting incoming call...');

      // Stop the ringtone since we're rejecting
      toneService.stopIncomingCallTone();

      // Reject the invite
      await this.currentInvite.reject();

      this.currentInvite = null;  // Clear the invite
      console.log('✅ Call rejected');
    } catch (error) {
      console.error('❌ Failed to reject call:', error);
      this.currentInvite = null;  // Clear invite on error
      throw error;
    }
  }

  async toggleMute(muted: boolean) {
    if (!this.currentCall) {
      console.warn('No active call to mute/unmute');
      return;
    }

    // Don't even try to use the SDK methods - go straight to WebRTC
    try {
      // Method 1: Try to access the RTCPeer and its local audio track
      const rtcPeerMap = this.currentCall.rtcPeerMap;
      if (rtcPeerMap && rtcPeerMap.size > 0) {
        // Get the first RTCPeer (there's usually only one in a 1-to-1 call)
        const rtcPeer = rtcPeerMap.values().next().value;
        if (rtcPeer?.localAudioTrack) {
          rtcPeer.localAudioTrack.enabled = !muted;
          console.log(`Audio ${muted ? 'muted' : 'unmuted'} via RTCPeer localAudioTrack`);
          return;
        }
      }

      // Method 2: Try to access the local stream directly
      if (this.currentCall._localStream) {
        const audioTracks = this.currentCall._localStream.getAudioTracks();
        if (audioTracks.length > 0) {
          audioTracks.forEach((track: MediaStreamTrack) => {
            track.enabled = !muted;
          });
          console.log(`Audio ${muted ? 'muted' : 'unmuted'} via _localStream`);
          return;
        }
      }

      // Method 3: Try to get the peer connection and its senders
      if (rtcPeerMap && rtcPeerMap.size > 0) {
        const rtcPeer = rtcPeerMap.values().next().value;
        if (rtcPeer?.instance) {
          const senders = rtcPeer.instance.getSenders();
          const audioSender = senders.find((sender: RTCRtpSender) => sender.track?.kind === 'audio');
          if (audioSender?.track) {
            audioSender.track.enabled = !muted;
            console.log(`Audio ${muted ? 'muted' : 'unmuted'} via RTCPeerConnection sender`);
            return;
          }
        }
      }

      // Method 4: Last resort - try to find any MediaStream in the call object
      for (const key of Object.keys(this.currentCall)) {
        const value = this.currentCall[key];
        if (value instanceof MediaStream) {
          const audioTracks = value.getAudioTracks();
          if (audioTracks.length > 0) {
            audioTracks.forEach(track => {
              track.enabled = !muted;
            });
            console.log(`Audio ${muted ? 'muted' : 'unmuted'} via MediaStream found at key: ${key}`);
            return;
          }
        }
      }

      console.warn('Could not find audio track to mute/unmute');
    } catch (error) {
      console.error('Error toggling mute:', error);
      // Don't throw - just log the error since mute is not critical
    }
  }

  async toggleSpeaker(speakerOn: boolean) {
    // This would need platform-specific implementation
    // For web, we can't directly control speaker output
    console.log('Speaker toggle:', speakerOn);
  }

  async sendDTMF(digit: string) {
    if (this.currentCall) {
      await this.currentCall.sendDigits(digit);
    }
  }

  private handleCallEnded() {
    console.log('🔔 handleCallEnded - cleaning up and notifying UI');

    // Use the tracked call direction
    const wasIncoming = this.wasIncomingCall;

    // Clear the current call and reset tracking
    this.currentCall = null;
    this.currentInvite = null;
    this.wasIncomingCall = false;

    // Notify the UI to return to idle state
    if (this.onCallEnded) {
      console.log('🔔 Notifying UI of call end, wasIncoming:', wasIncoming);
      this.onCallEnded(wasIncoming);
    }
  }

  disconnect() {
    // Guard against disconnect being called when client never initialized
    if (!this.client) {
      console.log('⚠️ Disconnect called but no client exists - ignoring');
      return;
    }

    console.log('🛑 SignalWire service disconnecting...');
    console.log('Current call exists?', !!this.currentCall);

    // Clean up the media container to avoid React DOM conflicts
    const mediaContainer = document.getElementById('signalwire-media');
    if (mediaContainer && mediaContainer.parentNode) {
      // Clear any child nodes first
      while (mediaContainer.firstChild) {
        mediaContainer.removeChild(mediaContainer.firstChild);
      }
      mediaContainer.parentNode.removeChild(mediaContainer);
      console.log('🗑️ Removed media container');
    }

    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }

    // Safely try to hangup current call if it exists
    if (this.currentCall && typeof this.currentCall.hangup === 'function') {
      this.currentCall.hangup().catch((error: any) => {
        // Ignore hangup errors during disconnect
        console.debug('Hangup error during disconnect (ignored):', error.message);
      });
      this.currentCall = null;
    }

    // Clear any pending invite
    this.currentInvite = null;

    // Go offline before disconnecting
    if (this.client && typeof this.client.offline === 'function') {
      this.client.offline().catch((error: any) => {
        console.debug('Offline error (ignored):', error.message);
      });
      this.isOnline = false;
    }

    // Safely disconnect the client - this should only happen on unmount
    if (this.client && typeof this.client.disconnect === 'function') {
      this.client.disconnect().catch((error: any) => {
        // Ignore disconnect errors
        console.debug('Client disconnect error (ignored):', error.message);
      });
      this.client = null;
      this.hasSetupListeners = false;
    }
  }
}

export const signalWireService = new SignalWireService();