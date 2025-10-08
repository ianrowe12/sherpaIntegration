import '@react-native-firebase/app-check';
import firebase from '@react-native-firebase/app';
import {APPCHECK_DEBUG_TOKEN_ANDROID, APPCHECK_DEBUG_TOKEN_IOS} from '@env';

// Track initialization status
let isAppCheckInitialized = false;

export const initializeAppCheck = () => {
  // Skip App Check entirely in development builds where Firebase is not configured
  if (__DEV__) {
    isAppCheckInitialized = true;
    return;
  }

  if (isAppCheckInitialized) {
    return;
  }

  try {
    const rnfbProvider = firebase
      .appCheck()
      .newReactNativeFirebaseAppCheckProvider();

    rnfbProvider.configure({
      android: {
        provider: __DEV__ ? 'debug' : 'playIntegrity',
        debugToken: APPCHECK_DEBUG_TOKEN_ANDROID,
      },
      apple: {
        provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback',
        debugToken: APPCHECK_DEBUG_TOKEN_IOS,
      },
    });
    firebase.appCheck().initializeAppCheck({
      provider: rnfbProvider,
      isTokenAutoRefreshEnabled: true,
    });

    isAppCheckInitialized = true;
  } catch (error) {
    console.error('Failed to initialize Firebase App Check:', error);
  }
};

// Get a fresh App Check token
export const getAppCheckToken = async () => {
  // In development builds without Firebase config, App Check is disabled
  if (__DEV__) {
    throw new Error('App Check disabled in development');
  }
  try {
    if (!firebase.appCheck) {
      throw new Error('Firebase App Check module is not available');
    }
    const {token} = await firebase.appCheck().getToken(true);
    return token;
  } catch (error) {
    console.error('Failed to get App Check token:', error);
    throw error;
  }
};
