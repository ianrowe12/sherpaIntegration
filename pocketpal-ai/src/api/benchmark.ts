import axios from 'axios';
import {Platform} from 'react-native';
import {urls} from '../config';
import {
  getAppCheckToken,
  checkConnectivity,
  NetworkError,
  AppCheckError,
  ServerError,
  initializeAppCheck,
} from '../utils';
import {BenchmarkResult, DeviceInfo} from '../utils/types';

type SubmissionData = {
  deviceInfo: DeviceInfo;
  benchmarkResult: BenchmarkResult;
};

/**
 * Submits benchmark data to the server with App Check verification
 */
export async function submitBenchmark(
  deviceInfo: DeviceInfo,
  benchmarkResult: BenchmarkResult,
): Promise<{message: string; id: number}> {
  try {
    // Check network connectivity first
    const isConnected = await checkConnectivity();
    if (!isConnected) {
      throw new NetworkError(
        'No internet connection. Please connect to the internet and try again.',
      );
    }

    const storeName =
      Platform.OS === 'android' ? 'Google Play Store' : 'Apple App Store';
    let errMessage = `App verification failed. Benchmark sharing is only available for official builds from ${storeName}.`;

    // Get App Check token
    let appCheckToken: string | null = null;
    try {
      initializeAppCheck();
      appCheckToken = await getAppCheckToken();
    } catch (error) {
      console.error('App Check error:', error);

      throw new AppCheckError(errMessage);
    }

    if (!appCheckToken) {
      throw new AppCheckError(errMessage);
    }

    // Prepare data and submit to server
    const data: SubmissionData = {
      deviceInfo,
      benchmarkResult,
    };

    try {
      const response = await axios.post(urls.benchmarkSubmit(), data, {
        headers: {
          'X-Firebase-AppCheck': appCheckToken,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (!error.response) {
          throw new NetworkError(
            'Network error. Please check your internet connection and try again.',
          );
        }

        const status = error.response.status;
        if (status === 401 || status === 403) {
          throw new AppCheckError(
            'App verification failed. This could be due to an unofficial app installation.',
          );
        } else if (status >= 500) {
          throw new ServerError(
            'Our servers are experiencing issues. Please try again later.',
          );
        } else {
          throw new ServerError(
            `Server error: ${error.response.data?.message || 'Unknown error'}`,
          );
        }
      }
      throw error;
    }
  } catch (error) {
    console.error('Error submitting benchmark:', error);

    if (
      error instanceof NetworkError ||
      error instanceof AppCheckError ||
      error instanceof ServerError
    ) {
      throw error;
    }

    throw new Error(
      error instanceof Error
        ? `Failed to submit benchmark: ${error.message}`
        : 'An unexpected error occurred',
    );
  }
}
