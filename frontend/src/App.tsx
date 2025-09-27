import { useEffect, useState } from 'react';
import Dialer from './components/Dialer';
import { useSignalWire } from './hooks/useSignalWire';
import { signalWireService } from './services/signalwire';

function App() {
  const { isInitialized, error } = useSignalWire();
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  useEffect(() => {
    // Handle proper cleanup only on page unload
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // Only disconnect when the page is actually being closed
      console.log('🚪 Page unloading event triggered');
      // Double-check this is a real unload event
      if (event && event.type === 'beforeunload') {
        console.log('🚪 Confirmed beforeunload - disconnecting SignalWire');
        signalWireService.disconnect();
      }
    };

    // Only add the listener, don't call the function
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Set minimum window size
    const setMinWindowSize = () => {
      // For Electron or other desktop environments
      if (window.resizeTo && window.outerWidth && window.outerHeight) {
        if (window.outerWidth < 360) {
          window.resizeTo(360, window.outerHeight);
        }
        if (window.outerHeight < 640) {
          window.resizeTo(window.outerWidth, 640);
        }
      }

      // CSS-based constraint for browser windows
      document.documentElement.style.minWidth = '360px';
      document.documentElement.style.minHeight = '640px';
      document.body.style.minWidth = '360px';
      document.body.style.minHeight = '640px';
    };

    setMinWindowSize();

    // Monitor window resize
    const handleResize = () => {
      setMinWindowSize();
    };

    window.addEventListener('resize', handleResize);

    // Request microphone permissions on load
    const requestPermissions = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Stop the stream immediately after getting permission
        stream.getTracks().forEach(track => track.stop());
        setPermissionsGranted(true);
      } catch (err) {
        console.error('Failed to get microphone permissions:', err);
        setPermissionsGranted(false);
      }
    };

    requestPermissions();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  if (!permissionsGranted) {
    return (
      <div className="flex flex-col h-screen bg-black items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-4">Microphone Permission Required</h1>
          <p className="text-gray-400 mb-8">
            Please allow microphone access to make and receive calls
          </p>
          <button
            onClick={async () => {
              try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                setPermissionsGranted(true);
              } catch (err) {
                alert('Microphone permission is required to use this app');
              }
            }}
            className="px-6 py-3 bg-ios-green text-white rounded-lg"
          >
            Grant Permission
          </button>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="flex flex-col h-screen bg-black items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ios-green mb-4 mx-auto"></div>
          <p className="text-gray-400">Connecting to SignalWire...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-screen bg-black items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-4 text-red-500">Connection Error</h1>
          <p className="text-gray-400 mb-8">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-ios-gray-700 text-white rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <Dialer />;
}

export default App;