import React, { useState, useEffect } from 'react';
import { PhoneOff, Mic, MicOff, Volume2, VolumeX, Keyboard } from 'lucide-react';
import DialPad from './DialPad';
import { useSignalWire } from '../hooks/useSignalWire';

interface CallScreenProps {
  phoneNumber: string;
  onEndCall: () => void;
  isMuted: boolean;
  isSpeakerOn: boolean;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
}

const CallScreen: React.FC<CallScreenProps> = ({
  phoneNumber,
  onEndCall,
  isMuted,
  isSpeakerOn,
  onToggleMute,
  onToggleSpeaker,
}) => {
  const [callDuration, setCallDuration] = useState(0);
  const [showDialPad, setShowDialPad] = useState(false);
  const [dialPadInput, setDialPadInput] = useState('');
  const { sendDTMF } = useSignalWire();

  useEffect(() => {
    const interval = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Handle keyboard input for DTMF during calls
  useEffect(() => {
    const handleKeyboardInput = (e: KeyboardEvent) => {
      // Only handle DTMF keys during active call
      if ((e.key >= '0' && e.key <= '9') || e.key === '*' || e.key === '#') {
        handleDialPadKey(e.key);
      }
    };

    window.addEventListener('keydown', handleKeyboardInput);
    return () => window.removeEventListener('keydown', handleKeyboardInput);
  }, []);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDialPadKey = async (key: string) => {
    // Send DTMF tone through the call
    console.log('Sending DTMF:', key);
    setDialPadInput(prev => prev + key);
    await sendDTMF(key);
  };

  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Status Bar - always visible */}
      <div className="relative flex items-center justify-between px-6 py-2 text-sm">
        <span className="text-ios-green">●</span>
        <span className="absolute left-1/2 transform -translate-x-1/2 text-gray-400">
          SignalWire
        </span>
        <span className="text-gray-400">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col min-h-0">
        {showDialPad ? (
          <>
            {/* Phone Number Display - matches idle dialer */}
            <div className="flex-1 flex items-center justify-center px-4 py-4 min-h-0">
              <div className="text-center">
                {dialPadInput ? (
                  <div className="text-3xl sm:text-4xl font-light">
                    {dialPadInput}
                  </div>
                ) : (
                  <div className="text-xl sm:text-2xl text-gray-500">Enter a number</div>
                )}
              </div>
            </div>

            {/* Dial Pad with Hide button */}
            <div className="pb-6 sm:pb-8">
              <DialPad
                onKeyPress={handleDialPadKey}
                onCall={() => setShowDialPad(false)} // Hide button
                onDelete={() => setDialPadInput(prev => prev.slice(0, -1))} // Delete functionality
                onClearAll={() => setDialPadInput('')} // Clear all functionality
                hasNumber={true}
                disabled={false}
                callButtonText="Hide"
              />
            </div>
          </>
        ) : (
          <>
            {/* Call Info */}
            <div className="flex-1 flex flex-col justify-center items-center px-4 py-4 min-h-0">
              <div className="text-center">
                <div className="text-sm text-gray-400 mb-2">calling...</div>
                <div className="text-2xl sm:text-3xl font-light mb-4">{phoneNumber}</div>
                <div className="text-lg sm:text-xl text-gray-300">{formatDuration(callDuration)}</div>
              </div>
            </div>

            {/* Call Controls - Bottom buttons */}
            <div className="pb-6 sm:pb-8">
              <div className="flex justify-center items-center w-full px-4">
                <div className="grid grid-cols-3 gap-3 sm:gap-4" style={{ maxWidth: '260px' }}>
                  {/* Mute Button */}
                  <button
                    onClick={onToggleMute}
                    className={`dial-button transition-all ${
                      isMuted ? 'bg-white text-black' : 'bg-ios-gray-700 text-white'
                    }`}
                  >
                    {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                  </button>

                  {/* Keypad Button */}
                  <button
                    onClick={() => setShowDialPad(true)}
                    className={`dial-button ${showDialPad ? 'ring-2 ring-white' : ''} bg-ios-gray-700`}
                  >
                    <Keyboard size={24} />
                  </button>

                  {/* Speaker Button */}
                  <button
                    onClick={onToggleSpeaker}
                    className={`dial-button transition-all ${
                      isSpeakerOn ? 'bg-white text-black' : 'bg-ios-gray-700 text-white'
                    }`}
                  >
                    {isSpeakerOn ? <Volume2 size={24} /> : <VolumeX size={24} />}
                  </button>

                  {/* Empty space for alignment */}
                  <div></div>

                  {/* End Call Button */}
                  <button
                    onClick={onEndCall}
                    className="dial-button bg-ios-red hover:bg-red-600 active:scale-95"
                  >
                    <PhoneOff size={32} fill="white" />
                  </button>

                  <div></div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CallScreen;