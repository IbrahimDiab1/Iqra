import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.ibrahimdiab1.iqra',
  appName: 'Iqra',
  // The native build configuration (`ng build --configuration native`) writes here.
  webDir: 'dist/native/browser',
  android: {
    // Only https content inside the app; no cleartext traffic.
    allowMixedContent: false,
  },
  plugins: {
    // Only Google sign-in is used; the other providers (and their SDKs and permissions) stay out of the APK.
    SocialLogin: {
      providers: { google: true, facebook: false, apple: false, twitter: false },
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_iqra',
      iconColor: '#1E6B64',
    },
  },
};

export default config;
