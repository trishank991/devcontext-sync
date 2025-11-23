// DevContext Sync - Payment Module
// Lean MVP using Stripe Payment Links

// Configuration - Replace these values before publishing to Chrome Web Store
// Create payment links at: https://dashboard.stripe.com/payment-links
//
// For production, replace the placeholder URLs below:
// 1. Create Stripe Payment Links for Pro ($12/mo) and Team ($19/user/mo)
// 2. Set up a license validation API endpoint
// 3. Update the values below
const CONFIG = {
  // Payment links - REPLACE with your actual Stripe payment links before release
  paymentLinks: {
    pro: 'https://buy.stripe.com/test_pro',    // TODO: Replace with actual Pro payment link
    team: 'https://buy.stripe.com/test_team'   // TODO: Replace with actual Team payment link
  },
  // License validation API - REPLACE with your backend URL
  // Set to null to use offline-only validation (less secure)
  licenseApiUrl: null  // TODO: Set to your API URL, e.g., 'https://api.yoursite.com/v1/license'
};

const LICENSE_PATTERN = /^DCS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function openPaymentPage(plan = 'pro') {
  const url = CONFIG.paymentLinks[plan] || CONFIG.paymentLinks.pro;

  // Warn in development if using placeholder links
  if (url.includes('test_')) {
    console.warn('DevContext: Using test payment link. Configure STRIPE_PRO_LINK for production.');
  }

  chrome.tabs.create({ url });
}

function validateLicenseKeyFormat(key) {
  if (!key || typeof key !== 'string') return false;
  return LICENSE_PATTERN.test(key.trim().toUpperCase());
}

async function verifyLicenseWithServer(licenseKey) {
  // If no API URL configured, fall back to offline validation
  if (!CONFIG.licenseApiUrl) {
    console.warn('DevContext: License API not configured. Using offline validation.');
    return { valid: true, offline: true };
  }

  try {
    const response = await fetch(`${CONFIG.licenseApiUrl}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ licenseKey })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    return {
      valid: result.valid === true,
      expiresAt: result.expiresAt,
      plan: result.plan,
      offline: false
    };
  } catch (error) {
    console.error('DevContext: License verification failed:', error.message);
    // On network error, check if we have a previously validated license
    const { devContextData } = await chrome.storage.local.get('devContextData');
    if (devContextData?.settings?.licenseValidatedAt) {
      // Allow grace period of 7 days for offline use
      const gracePeriod = 7 * 24 * 60 * 60 * 1000;
      const lastValidated = devContextData.settings.licenseValidatedAt;
      if (Date.now() - lastValidated < gracePeriod) {
        return { valid: true, offline: true, cached: true };
      }
    }
    return { valid: false, error: 'Unable to verify license. Please check your connection.' };
  }
}

async function activateLicense(key) {
  if (!key || typeof key !== 'string') {
    return { success: false, message: 'Please enter a license key' };
  }

  const normalizedKey = key.trim().toUpperCase();

  if (!validateLicenseKeyFormat(normalizedKey)) {
    return {
      success: false,
      message: 'Invalid license key format. Expected: DCS-XXXX-XXXX-XXXX'
    };
  }

  // Verify license with server
  const verification = await verifyLicenseWithServer(normalizedKey);

  if (!verification.valid) {
    return {
      success: false,
      message: verification.error || 'Invalid license key. Please check and try again.'
    };
  }

  try {
    const { devContextData } = await chrome.storage.local.get('devContextData');
    const data = devContextData || { settings: {} };

    data.settings.isPremium = true;
    data.settings.licenseKey = normalizedKey;
    data.settings.activatedAt = Date.now();
    data.settings.licenseValidatedAt = Date.now();
    data.settings.licensePlan = verification.plan || 'pro';
    if (verification.expiresAt) {
      data.settings.licenseExpiresAt = verification.expiresAt;
    }

    await chrome.storage.local.set({ devContextData: data });

    const offlineNote = verification.offline ? ' (offline mode)' : '';
    return {
      success: true,
      message: `License activated! Enjoy Pro features.${offlineNote}`
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to activate license. Please try again.'
    };
  }
}

async function getLicenseStatus() {
  try {
    const { devContextData } = await chrome.storage.local.get('devContextData');
    const settings = devContextData?.settings || {};

    return {
      isPremium: settings.isPremium || false,
      licenseKey: settings.licenseKey || null,
      activatedAt: settings.activatedAt || null
    };
  } catch (error) {
    return { isPremium: false, licenseKey: null, activatedAt: null };
  }
}

async function deactivateLicense() {
  try {
    const { devContextData } = await chrome.storage.local.get('devContextData');
    if (devContextData?.settings) {
      devContextData.settings.isPremium = false;
      devContextData.settings.licenseKey = null;
      devContextData.settings.activatedAt = null;
      await chrome.storage.local.set({ devContextData });
    }
    return { success: true, message: 'License deactivated' };
  } catch (error) {
    return { success: false, message: 'Failed to deactivate license' };
  }
}
