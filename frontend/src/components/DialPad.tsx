import React from 'react';
import { Phone, Delete } from 'lucide-react';
import { DialPadKey } from '../types';

interface DialPadProps {
  onKeyPress: (key: string) => void;
  onCall: () => void;
  onDelete: () => void;
  hasNumber: boolean;
  disabled?: boolean;
  hideText?: string; // Optional text to show instead of delete icon
  callButtonText?: string; // Optional text to show on call button instead of phone icon
}

const dialPadKeys: DialPadKey[][] = [
  [
    { number: '1', letters: ' ' },  // Space to maintain alignment
    { number: '2', letters: 'ABC' },
    { number: '3', letters: 'DEF' },
  ],
  [
    { number: '4', letters: 'GHI' },
    { number: '5', letters: 'JKL' },
    { number: '6', letters: 'MNO' },
  ],
  [
    { number: '7', letters: 'PQRS' },
    { number: '8', letters: 'TUV' },
    { number: '9', letters: 'WXYZ' },
  ],
  [
    { number: '*', special: true },
    { number: '0', letters: '+' },
    { number: '#', special: true },
  ],
];

const DialPad: React.FC<DialPadProps> = ({
  onKeyPress,
  onCall,
  onDelete,
  hasNumber,
  disabled = false,
  hideText,
  callButtonText
}) => {
  const handleKeyPress = (key: string) => {
    if (!disabled) {
      onKeyPress(key);
      // Play DTMF tone here if needed
      playDTMFTone(key);
    }
  };

  const playDTMFTone = (key: string) => {
    // Simple tone generation using Web Audio API
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator1 = audioContext.createOscillator();
    const oscillator2 = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // DTMF frequencies
    const frequencies: { [key: string]: [number, number] } = {
      '1': [697, 1209],
      '2': [697, 1336],
      '3': [697, 1477],
      '4': [770, 1209],
      '5': [770, 1336],
      '6': [770, 1477],
      '7': [852, 1209],
      '8': [852, 1336],
      '9': [852, 1477],
      '*': [941, 1209],
      '0': [941, 1336],
      '#': [941, 1477],
    };

    if (frequencies[key]) {
      oscillator1.frequency.value = frequencies[key][0];
      oscillator2.frequency.value = frequencies[key][1];

      oscillator1.connect(gainNode);
      oscillator2.connect(gainNode);
      gainNode.connect(audioContext.destination);

      gainNode.gain.value = 0.1;

      oscillator1.start();
      oscillator2.start();

      setTimeout(() => {
        oscillator1.stop();
        oscillator2.stop();
        audioContext.close();
      }, 200);
    }
  };

  return (
    <div className="flex justify-center items-center w-full px-4">
      <div className="grid grid-cols-3 gap-3 sm:gap-4" style={{ maxWidth: '260px' }}>
        {/* Number Keys */}
        {dialPadKeys.map((row, rowIndex) => (
          <React.Fragment key={rowIndex}>
            {row.map((key) => (
              <button
                key={key.number}
                className="dial-button bg-ios-gray-700 hover:bg-ios-gray-600"
                onClick={() => handleKeyPress(key.number)}
                disabled={disabled}
              >
                {key.special ? (
                  // Special characters with different sizes and positioning
                  <span className={`font-light leading-none ${
                    key.number === '*'
                      ? 'text-6xl sm:text-7xl relative top-[10px]'  // Asterisk lowered more for proper centering
                      : 'text-3xl sm:text-4xl'  // Hash stays normal
                  }`}>{key.number}</span>
                ) : (
                  <>
                    <span className="dial-button-number">{key.number}</span>
                    {key.letters && (
                      <span className="dial-button-letters">
                        {key.letters.trim() || '\u00A0'} {/* Non-breaking space for alignment */}
                      </span>
                    )}
                  </>
                )}
              </button>
            ))}
          </React.Fragment>
        ))}

        {/* Bottom Row: Empty, Call Button, Delete */}
        <div className="dial-button invisible"></div>

        <button
          onClick={onCall}
          disabled={disabled}
          className="dial-button bg-ios-green hover:bg-green-600"
        >
          {callButtonText ? (
            <span className="text-lg font-normal">{callButtonText}</span>
          ) : (
            <Phone size={32} fill="white" />
          )}
        </button>

        {hasNumber ? (
          <button
            onClick={onDelete}
            className="dial-button hover:bg-ios-gray-600"
          >
            {hideText ? (
              <span className="text-sm text-gray-300">{hideText}</span>
            ) : (
              <Delete size={24} className="text-gray-300" />
            )}
          </button>
        ) : (
          <div className="dial-button invisible"></div>
        )}
      </div>
    </div>
  );
};

export default DialPad;