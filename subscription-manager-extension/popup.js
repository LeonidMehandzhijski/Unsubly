document.addEventListener('DOMContentLoaded', () => {
  const scanButton = document.getElementById('scanButton');
  const categoryFilter = document.getElementById('categoryFilter');
  const searchInput = document.getElementById('searchInput');
  const subscriptionList = document.getElementById('subscriptionList');
  const unsubscribeButton = document.getElementById('unsubscribeSelected');
  
  // Load existing subscriptions
  loadSubscriptions();
  
  // Event listeners
  scanButton.addEventListener('click', handleScan);
  categoryFilter.addEventListener('change', filterSubscriptions);
  searchInput.addEventListener('input', filterSubscriptions);
  unsubscribeButton.addEventListener('click', handleUnsubscribe);
  
  // Handle scan button click
  async function handleScan() {
    try {
      scanButton.disabled = true;
      scanButton.textContent = 'Scanning...';
      subscriptionList.innerHTML = '<div class="loading">Scanning your emails...</div>';
      
      const response = await chrome.runtime.sendMessage({ action: 'scanEmails' });
      
      if (response.success) {
        await loadSubscriptions();
      } else {
        showError('Failed to scan emails: ' + response.error);
      }
    } catch (error) {
      showError('Error: ' + error.message);
    } finally {
      scanButton.disabled = false;
      scanButton.textContent = 'Scan Emails';
    }
  }
  
  // Load subscriptions from storage
  async function loadSubscriptions() {
    const { subscriptions } = await chrome.storage.local.get('subscriptions');
    displaySubscriptions(subscriptions || []);
    updateStats(subscriptions || []);
  }
  
  // Display subscriptions in the list
  function displaySubscriptions(subscriptions) {
    if (!subscriptions || subscriptions.length === 0) {
      subscriptionList.innerHTML = '<div class="loading">No subscriptions found. Click "Scan Emails" to start.</div>';
      return;
    }
    
    subscriptionList.innerHTML = subscriptions.map(sub => `
      <div class="subscription-item" data-id="${sub.id}" data-unsubscribe-link="${sub.unsubscribeLink || ''}">
        <input type="checkbox" class="subscription-checkbox">
        <div class="subscription-info">
          <p class="subscription-name">${escapeHtml(sub.from)}</p>
          <p class="subscription-details">
            ${escapeHtml(sub.category)} • 
            ${sub.relatedEmails ? `${sub.relatedEmails.length} emails` : '1 email'} • 
            Last: ${formatDate(sub.date)}
          </p>
          <p class="subscription-latest">${escapeHtml(sub.subject)}</p>
        </div>
      </div>
    `).join('');
  }
  
  // Update statistics
  function updateStats(subscriptions) {
    const totalCount = document.getElementById('totalCount');
    const newsletterCount = document.getElementById('newsletterCount');
    const socialCount = document.getElementById('socialCount');
    
    // Count unique subscriptions by category
    const stats = subscriptions.reduce((acc, sub) => {
      acc[sub.category] = (acc[sub.category] || 0) + 1;
      return acc;
    }, {});
    
    totalCount.textContent = subscriptions.length;
    newsletterCount.textContent = stats.newsletter || 0;
    socialCount.textContent = stats.social || 0;
  }
  
  // Format date helper
  function formatDate(dateStr) {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
      });
    } catch (e) {
      return 'Unknown date';
    }
  }
  
  // Filter subscriptions based on category and search
  function filterSubscriptions() {
    const category = categoryFilter.value;
    const searchTerm = searchInput.value.toLowerCase();
    
    const items = subscriptionList.querySelectorAll('.subscription-item');
    items.forEach(item => {
      const name = item.querySelector('.subscription-name').textContent.toLowerCase();
      const details = item.querySelector('.subscription-details').textContent.toLowerCase();
      
      const matchesCategory = category === 'all' || details.includes(category);
      const matchesSearch = !searchTerm || 
        name.includes(searchTerm) || 
        details.includes(searchTerm) ||
        item.querySelector('.subscription-latest').textContent.toLowerCase().includes(searchTerm);
      
      item.style.display = matchesCategory && matchesSearch ? 'flex' : 'none';
    });
  }
  
  // Handle unsubscribe button click
  async function handleUnsubscribe() {
    const selectedItems = Array.from(subscriptionList.querySelectorAll('.subscription-checkbox:checked'))
      .map(checkbox => checkbox.closest('.subscription-item'));
    
    if (selectedItems.length === 0) {
      showError('Please select subscriptions to unsubscribe from');
      return;
    }
    
    const itemsWithLinks = selectedItems.filter(item => item.dataset.unsubscribeLink);
    const itemsWithoutLinks = selectedItems.filter(item => !item.dataset.unsubscribeLink);
    
    if (itemsWithoutLinks.length > 0) {
      showError(`Could not find unsubscribe links for ${itemsWithoutLinks.length} selected items`);
    }
    
    if (itemsWithLinks.length === 0) {
      return;
    }
    
    try {
      unsubscribeButton.disabled = true;
      unsubscribeButton.textContent = 'Processing...';
      
      const response = await chrome.runtime.sendMessage({
        action: 'unsubscribe',
        emailIds: itemsWithLinks.map(item => ({
          id: item.dataset.id,
          unsubscribeLink: item.dataset.unsubscribeLink
        }))
      });
      
      if (response.success) {
        // Remove unsubscribed items from the list
        itemsWithLinks.forEach(item => item.remove());
        // Update stats
        const remainingCount = subscriptionList.querySelectorAll('.subscription-item').length;
        document.getElementById('totalCount').textContent = remainingCount;
      } else {
        showError('Failed to unsubscribe: ' + response.error);
      }
    } catch (error) {
      showError('Error: ' + error.message);
    } finally {
      unsubscribeButton.disabled = false;
      unsubscribeButton.textContent = 'Unsubscribe Selected';
    }
  }
  
  // Show error message
  function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = message;
    
    subscriptionList.insertBefore(errorDiv, subscriptionList.firstChild);
    
    setTimeout(() => {
      errorDiv.remove();
    }, 5000);
  }
  
  // Escape HTML to prevent XSS
  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}); 