async function unsubscribe(subscription) {
  try {
    console.log('Starting unsubscribe process for:', subscription);
    
    // Get auth token
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Failed to get auth token');
    }

    // Delete the email
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${subscription.id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to delete email: ${response.statusText}`);
    }

    // Show success notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Successfully Unsubscribed',
      message: `Unsubscribed from ${subscription.sender}`
    });

    // Update storage
    const { subscriptions = [] } = await chrome.storage.local.get('subscriptions');
    const updatedSubscriptions = subscriptions.filter(s => s.id !== subscription.id);
    await chrome.storage.local.set({ subscriptions: updatedSubscriptions });

    // Notify popup to update
    chrome.runtime.sendMessage({ type: 'SUBSCRIPTION_UPDATED' });

    return true;
  } catch (error) {
    console.error('Error unsubscribing:', error);
    
    // Show error notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Unsubscribe Failed',
      message: `Failed to unsubscribe from ${subscription.sender}. Please try again.`
    });
    
    return false;
  }
} 