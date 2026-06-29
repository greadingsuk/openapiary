import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'grantreadings.openapiary.app',
  appName: 'OpenApiary',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#fff8e6',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashImmersive: false,
    },
  },
};

export default config;
