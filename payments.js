// DevContext Sync - Payment Module
// Lean MVP using Stripe Payment Links

// Configuration - Replace with your actual Stripe Payment Links
// Create at: https://dashboard.stripe.com/payment-links
const PAYMENT_LINKS = {
  pro: 'https://buy.stripe.com/REPLACE_PRO_LINK',      // $12/month
  team: 'https://buy.stripe.com/REPLACE_TEAM_LINK'    // $19/user/month
};

const LICENSE_PATTERN = /^DCS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function openPaymentPage(plan = 'pro') {
  const url = PAYMENT_LINKS[plan] || PAYMENT_LINKS.pro;
  chrome.tabs.create({ url });
}

function validateLicenseKey(key) {
  if (!key || typeof key !== 'string') return false;
  return LICENSE_PATTERN.test(key.trim().toUpperCase());
}

async function activateLicense(key) {
  if (!key || typeof key !== 'string') {
    return { success: false, message: 'Please enter a license key' };
  }

  const normalizedKey = key.trim().toUpperCase();

  if (!validateLicenseKey(normalizedKey)) {
    return {
      success: false,
      message: 'Invalid license key format. Expected: DCS-XXXX-XXXX-XXXX'
    };
  }

  try {
    const { devContextData } = await chrome.storage.local.get('devContextData');
    const data = devContextData || { settings: {} };

    data.settings.isPremium = true;
    data.settings.licenseKey = normalizedKey;
    data.settings.activatedAt = Date.now();

    await chrome.storage.local.set({ devContextData: data });

    return {
      success: true,
      message: 'License activated! Enjoy Pro features.'
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
