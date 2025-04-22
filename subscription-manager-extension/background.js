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
        if (chrome.runtime.lastError.message.includes('invalid')) {
          try {
            await removeCachedToken(token);
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

// Scan emails for subscriptions
async function scanEmails() {
  try {
    console.log('Getting auth token...');
    const token = await getAuthToken();
    console.log('Auth token received');
    
    console.log('Fetching emails...');
    const response = await fetch(
      `${GMAIL_API_BASE}/messages?q=in:inbox (unsubscribe OR subscription OR newsletter)&maxResults=100`,
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
    const messages = data.messages || [];
    const totalMessages = messages.length;
    console.log(`Found ${totalMessages} messages`);
    
    let processedCount = 0;
    const subscriptionMap = new Map();
    
    for (const message of messages) {
      try {
        const email = await fetchEmailDetails(message.id, token);
        const subscription = analyzeEmail(email);
        
        if (subscription) {
          const senderKey = getSenderKey(subscription.from);
          if (!subscriptionMap.has(senderKey)) {
            subscriptionMap.set(senderKey, subscription);
          }
        }
        
        processedCount++;
        chrome.runtime.sendMessage({
          action: 'scanProgress',
          data: {
            processed: processedCount,
            total: totalMessages,
            percentage: Math.round((processedCount / totalMessages) * 100)
          }
        });
      } catch (error) {
        console.error('Error processing message:', error);
        // Continue with next message
      }
    }
    
    const subscriptions = Array.from(subscriptionMap.values());
    console.log(`Found ${subscriptions.length} unique subscriptions`);
    
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

// Helper function to normalize sender email for grouping
function getSenderKey(from) {
  const emailMatch = from.match(/<(.+?)>/) || [null, from];
  const email = emailMatch[1].toLowerCase();
  return email.replace(/\+[^@]+@/, '@');
}

// Analyze email to identify subscription type
function analyzeEmail(email) {
  const headers = email.payload.headers;
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const date = headers.find(h => h.name === 'Date')?.value;
  
  const body = decodeEmailBody(email);
  const unsubscribeLink = extractUnsubscribeLink(email, body);
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
  const htmlPart = email.payload.parts?.find(p => p.mimeType === 'text/html')?.body.data;
  if (htmlPart) {
    return atob(htmlPart.replace(/-/g, '+').replace(/_/g, '/'));
  }
  
  const plainPart = email.payload.parts?.find(p => p.mimeType === 'text/plain')?.body.data || email.payload.body.data;
  if (!plainPart) return '';
  
  return atob(plainPart.replace(/-/g, '+').replace(/_/g, '/'));
}

// Extract unsubscribe link from email
function extractUnsubscribeLink(email, body) {
  // First check List-Unsubscribe header
  const unsubscribeHeader = email.payload.headers.find(h => h.name === 'List-Unsubscribe');
  if (unsubscribeHeader) {
    const urlMatch = unsubscribeHeader.value.match(/<(https?:\/\/[^>]+)>/);
    if (urlMatch) return urlMatch[1];
  }
  
  // Then check body for common patterns
  const patterns = [
    /<a[^>]*href=["']([^"']+)["'][^>]*>(?:[^<]*)?unsubscribe(?:[^<]*)?<\/a>/i,
    /unsubscribe\s*link:\s*(https?:\/\/[^\s<>"]+)/i,
    /click\s*here\s*to\s*unsubscribe:\s*(https?:\/\/[^\s<>"]+)/i,
    /<a[^>]*href=["'](https?:\/\/[^"']*unsubscribe[^"']*)["'][^>]*>/i
  ];
  
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1];
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
    console.log('Processing unsubscribe requests:', emailData);
    return { success: true, emailData };
  } catch (error) {
    console.error('Error unsubscribing:', error);
    return { success: false, error: error.message };
  }
} 