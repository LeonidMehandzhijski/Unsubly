// Gmail API configuration
const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify'
];

// Subscription detection patterns
const SUBSCRIPTION_PATTERNS = {
  newsletter: [
    'unsubscribe',
    'subscription',
    'newsletter',
    'mailing list',
    'email preferences'
  ],
  social: [
    'linkedin',
    'facebook',
    'twitter',
    'instagram',
    'youtube',
    'reddit',
    'pinterest'
  ],
  service: [
    'account',
    'billing',
    'payment',
    'service',
    'membership'
  ]
};

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed. Setting up initial storage...');
  chrome.storage.local.set({
    subscriptions: [],
    lastScan: null
  });
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request);
  if (request.action === 'scanEmails') {
    console.log('Starting email scan...');
    scanEmails().then(response => {
      console.log('Scan completed:', response);
      sendResponse(response);
    });
    return true; // Will respond asynchronously
  }
  if (request.action === 'unsubscribe') {
    console.log('Starting unsubscribe process for:', request.emailIds);
    unsubscribeFromEmails(request.emailIds).then(sendResponse);
    return true;
  }
});

// Scan emails for subscriptions
async function scanEmails() {
  try {
    console.log('Getting auth token...');
    const token = await getAuthToken();
    console.log('Auth token received');
    
    console.log('Fetching emails...');
    const messages = await fetchEmails(token);
    console.log(`Found ${messages.length} messages`);
    
    console.log('Processing emails...');
    const subscriptions = await processEmails(messages, token);
    console.log(`Processed ${subscriptions.length} subscriptions`);
    
    await chrome.storage.local.set({
      subscriptions,
      lastScan: new Date().toISOString()
    });
    
    return { success: true, subscriptions };
  } catch (error) {
    console.error('Error scanning emails:', error);
    return { success: false, error: error.message };
  }
}

// Get authentication token with retry
async function getAuthToken() {
  return new Promise((resolve, reject) => {
    console.log('Requesting auth token...');
    chrome.identity.getAuthToken({ 
      interactive: true,
      scopes: SCOPES
    }, async (token) => {
      if (chrome.runtime.lastError) {
        console.error('Auth token error:', chrome.runtime.lastError);
        // If token is invalid, try removing it and getting a new one
        if (chrome.runtime.lastError.message.includes('invalid')) {
          try {
            await removeCachedToken(token);
            // Retry getting the token
            chrome.identity.getAuthToken({ 
              interactive: true,
              scopes: SCOPES
            }, (newToken) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                console.log('New auth token obtained successfully');
                resolve(newToken);
              }
            });
          } catch (error) {
            reject(error);
          }
        } else {
          reject(chrome.runtime.lastError);
        }
      } else {
        console.log('Auth token obtained successfully');
        resolve(token);
      }
    });
  });
}

// Remove cached token
async function removeCachedToken(token) {
  return new Promise((resolve, reject) => {
    chrome.identity.removeCachedAuthToken({ token }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

// Fetch emails from Gmail
async function fetchEmails(token) {
  const response = await fetch(
    `${GMAIL_API_BASE}/messages?q=in:inbox (unsubscribe OR subscription OR newsletter)`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to fetch emails');
  }
  
  const data = await response.json();
  return data.messages || [];
}

// Process emails to identify subscriptions
async function processEmails(messages, token) {
  const subscriptionMap = new Map(); // Map to store unique subscriptions by sender
  
  for (const message of messages) {
    const email = await fetchEmailDetails(message.id, token);
    const subscription = analyzeEmail(email);
    
    if (subscription) {
      const senderKey = getSenderKey(subscription.from);
      
      // If we already have a subscription from this sender, update it
      if (subscriptionMap.has(senderKey)) {
        const existing = subscriptionMap.get(senderKey);
        // Keep the most recent email and accumulate related emails
        if (new Date(subscription.date) > new Date(existing.date)) {
          existing.subject = subscription.subject;
          existing.date = subscription.date;
          existing.unsubscribeLink = subscription.unsubscribeLink || existing.unsubscribeLink;
        }
        existing.relatedEmails = existing.relatedEmails || [];
        existing.relatedEmails.push({
          id: subscription.id,
          subject: subscription.subject,
          date: subscription.date
        });
      } else {
        // New unique subscription
        subscriptionMap.set(senderKey, {
          ...subscription,
          senderKey,
          relatedEmails: [{
            id: subscription.id,
            subject: subscription.subject,
            date: subscription.date
          }]
        });
      }
    }
  }
  
  return Array.from(subscriptionMap.values());
}

// Helper function to normalize sender email for grouping
function getSenderKey(from) {
  // Extract email from "Name <email@domain.com>" format
  const emailMatch = from.match(/<(.+?)>/) || [null, from];
  const email = emailMatch[1].toLowerCase();
  // Remove any subaddress (e.g., +tag in email+tag@domain.com)
  return email.replace(/\+[^@]+@/, '@');
}

// Fetch detailed email content
async function fetchEmailDetails(messageId, token) {
  const response = await fetch(
    `${GMAIL_API_BASE}/messages/${messageId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to fetch email details');
  }
  
  return await response.json();
}

// Analyze email to identify subscription type
function analyzeEmail(email) {
  const headers = email.payload.headers;
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const date = headers.find(h => h.name === 'Date')?.value;
  
  // Extract unsubscribe link
  const body = decodeEmailBody(email);
  const unsubscribeLink = extractUnsubscribeLink(body);
  
  // Determine category
  const category = determineCategory(subject, from, body);
  
  if (category) {
    return {
      id: email.id,
      subject,
      from,
      category,
      unsubscribeLink,
      date
    };
  }
  
  return null;
}

// Decode email body
function decodeEmailBody(email) {
  // Implementation depends on email format (multipart, plain text, etc.)
  // This is a simplified version
  const body = email.payload.parts
    ? email.payload.parts.find(p => p.mimeType === 'text/plain')?.body.data
    : email.payload.body.data;
    
  if (!body) return '';
  
  return atob(body.replace(/-/g, '+').replace(/_/g, '/'));
}

// Extract unsubscribe link from email body
function extractUnsubscribeLink(body) {
  const unsubscribePatterns = [
    // Direct unsubscribe links
    /unsubscribe\s*link:\s*(https?:\/\/[^\s<>"]+)/i,
    /click\s*here\s*to\s*unsubscribe:\s*(https?:\/\/[^\s<>"]+)/i,
    /<a[^>]*href=["'](https?:\/\/[^"']*unsubscribe[^"']*)["'][^>]*>/i,
    
    // Common unsubscribe patterns
    /<a[^>]*href=["'](https?:\/\/[^"']*preferences[^"']*)["'][^>]*>/i,
    /<a[^>]*href=["'](https?:\/\/[^"']*email-preferences[^"']*)["'][^>]*>/i,
    /<a[^>]*href=["'](https?:\/\/[^"']*manage-subscription[^"']*)["'][^>]*>/i,
    /<a[^>]*href=["'](https?:\/\/[^"']*subscription-preferences[^"']*)["'][^>]*>/i,
    
    // Text-based patterns
    /(?:unsubscribe|opt-out|manage preferences|email preferences)[^:]*:\s*(https?:\/\/[^\s<>"]+)/i,
    /(?:unsubscribe|opt-out|manage preferences|email preferences)[^:]*\s+(https?:\/\/[^\s<>"]+)/i,
    
    // List-unsubscribe header pattern
    /<mailto:unsubscribe@[^>]+>/i,
    
    // Generic link patterns
    /<a[^>]*href=["'](https?:\/\/[^"']*pref[^"']*)["'][^>]*>/i,
    /<a[^>]*href=["'](https?:\/\/[^"']*manage[^"']*)["'][^>]*>/i
  ];
  
  for (const pattern of unsubscribePatterns) {
    const match = body.match(pattern);
    if (match) {
      // Clean up the URL if it's a mailto link
      let url = match[1];
      if (url.startsWith('mailto:')) {
        url = url.replace('mailto:', '');
      }
      return url;
    }
  }
  
  return null;
}

// Determine subscription category
function determineCategory(subject, from, body) {
  const text = `${subject} ${from} ${body}`.toLowerCase();
  
  for (const [category, patterns] of Object.entries(SUBSCRIPTION_PATTERNS)) {
    if (patterns.some(pattern => text.includes(pattern))) {
      return category;
    }
  }
  
  return 'other';
}

// Unsubscribe from selected emails
async function unsubscribeFromEmails(emailData) {
  try {
    console.log('Starting unsubscribe process for:', emailData);
    
    // Open each unsubscribe link in a new tab
    for (const { id, unsubscribeLink } of emailData) {
      if (unsubscribeLink) {
        console.log(`Opening unsubscribe link for email ${id}:`, unsubscribeLink);
        await chrome.tabs.create({ url: unsubscribeLink });
        
        // Update storage to remove the unsubscribed item
        const { subscriptions } = await chrome.storage.local.get('subscriptions');
        const updatedSubscriptions = subscriptions.filter(sub => sub.id !== id);
        await chrome.storage.local.set({ subscriptions: updatedSubscriptions });
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error unsubscribing:', error);
    return { success: false, error: error.message };
  }
} 