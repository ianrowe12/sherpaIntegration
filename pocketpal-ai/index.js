/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
// Polyfill Buffer for libraries that expect it in React Native
import {Buffer} from 'buffer';
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

AppRegistry.registerComponent(appName, () => App);
