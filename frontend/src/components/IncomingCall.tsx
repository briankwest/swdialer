import React, { useEffect } from 'react';
import { Phone, PhoneOff } from 'lucide-react';

interface IncomingCallProps {
  phoneNumber: string;
  onAnswer: () => void;
  onReject: () => void;
}

const IncomingCall: React.FC<IncomingCallProps> = ({
  phoneNumber,
  onAnswer,
  onReject,
}) => {
  useEffect(() => {
    // Play ringtone
    const audio = new Audio('/ringtone.mp3');
    audio.loop = true;
    audio.play().catch(console.error);

    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-gray-900 to-black">
      {/* Caller Info */}
      <div className="flex-1 flex flex-col justify-center items-center px-6">
        <div className="text-center">
          <div className="text-sm text-gray-400 mb-4">Incoming call</div>
          <div className="text-3xl font-light mb-8">{phoneNumber}</div>

          {/* Avatar placeholder */}
          <div className="w-32 h-32 rounded-full bg-ios-gray-700 mx-auto mb-8 flex items-center justify-center">
            <Phone size={48} className="text-gray-400" />
          </div>
        </div>
      </div>

      {/* Action Buttons - using same size as dial pad */}
      <div className="flex justify-center items-center w-full px-4 pb-6 sm:pb-8">
        <div className="flex gap-8">
          {/* Reject Button */}
          <div className="flex flex-col items-center">
            <button
              onClick={onReject}
              className="dial-button bg-ios-red hover:bg-red-600"
            >
              <PhoneOff size={32} fill="white" />
            </button>
            <span className="text-xs text-gray-400 mt-2">Decline</span>
          </div>

          {/* Answer Button */}
          <div className="flex flex-col items-center">
            <button
              onClick={onAnswer}
              className="dial-button bg-ios-green hover:bg-green-600 animate-pulse"
            >
              <Phone size={32} fill="white" />
            </button>
            <span className="text-xs text-gray-400 mt-2">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IncomingCall;