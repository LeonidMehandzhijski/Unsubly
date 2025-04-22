document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup initialized');
  
  const scanButton = document.getElementById('scanButton');
  const categoryFilter = document.getElementById('categoryFilter');
  const searchInput = document.getElementById('searchInput');
  const subscriptionList = document.getElementById('subscriptionList');
  const unsubscribeButton = document.getElementById('unsubscribeSelected');
  const lastScanElement = document.getElementById('lastScan');
  
  // Add progress bar HTML
  const progressContainer = document.createElement('div');
  progressContainer.className = 'progress-container';
  progressContainer.innerHTML = `
    <div class="progress-bar">
      <div class="progress-fill"></div>
    </div>
    <div class="progress-text">Scanning emails...</div>
  `;
  subscriptionList.parentNode.insertBefore(progressContainer, subscriptionList);
  
  console.log('Elements found:', {
    scanButton: !!scanButton,
    categoryFilter: !!categoryFilter,
    searchInput: !!searchInput,
    subscriptionList: !!subscriptionList,
    unsubscribeButton: !!unsubscribeButton
  });
  
  // Load existing subscriptions and update last scan time
  loadSubscriptions();
  
  // Event listeners
  scanButton.addEventListener('click', handleScan);
  categoryFilter.addEventListener('change', filterSubscriptions);
  searchInput.addEventListener('input', filterSubscriptions);
  unsubscribeButton.addEventListener('click', handleUnsubscribe);
  
  // Listen for progress updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'scanProgress') {
      updateProgress(message.data);
    }
  });
  
  // Load subscriptions and update UI
  async function loadSubscriptions() {
    const { subscriptions, lastScan } = await chrome.storage.local.get(['subscriptions', 'lastScan']);
    displaySubscriptions(subscriptions || []);
    updateStats(subscriptions || []);
    updateLastScanTime(lastScan);
  }
  
  // Update progress bar
  function updateProgress(data) {
    const { processed, total, percentage } = data;
    progressContainer.classList.add('active');
    const progressFill = progressContainer.querySelector('.progress-fill');
    const progressText = progressContainer.querySelector('.progress-text');
    
    progressFill.style.width = `${percentage}%`;
    progressText.textContent = `Scanning emails... ${processed}/${total} (${percentage}%)`;
    
    if (processed === total) {
      setTimeout(() => {
        progressContainer.classList.remove('active');
      }, 1000);
    }
  }
  
  // Format and display last scan time
  function updateLastScanTime(lastScan) {
    if (!lastScan) {
      lastScanElement.textContent = 'Never scanned';
      return;
    }
    
    const date = new Date(lastScan);
    const now = new Date();
    const diff = now - date;
    
    // Format relative time
    let timeAgo;
    if (diff < 60000) { // less than 1 minute
      timeAgo = 'Just now';
    } else if (diff < 3600000) { // less than 1 hour
      const minutes = Math.floor(diff / 60000);
      timeAgo = `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    } else if (diff < 86400000) { // less than 1 day
      const hours = Math.floor(diff / 3600000);
      timeAgo = `${hours} hour${hours === 1 ? '' : 's'} ago`;
    } else {
      const days = Math.floor(diff / 86400000);
      timeAgo = `${days} day${days === 1 ? '' : 's'} ago`;
    }
    
    lastScanElement.textContent = `Last scan: ${timeAgo}`;
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
    
    console.log('Selected items:', selectedItems);
    
    if (selectedItems.length === 0) {
      showError('Please select subscriptions to unsubscribe from');
      return;
    }
    
    // Log the dataset of each selected item
    selectedItems.forEach(item => {
      console.log('Item dataset:', {
        id: item.dataset.id,
        unsubscribeLink: item.dataset.unsubscribeLink
      });
    });
    
    const itemsWithLinks = selectedItems.filter(item => item.dataset.unsubscribeLink && item.dataset.unsubscribeLink.trim() !== '');
    const itemsWithoutLinks = selectedItems.filter(item => !item.dataset.unsubscribeLink || item.dataset.unsubscribeLink.trim() === '');
    
    console.log('Items with links:', itemsWithLinks);
    console.log('Items without links:', itemsWithoutLinks);
    
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
        // Open unsubscribe links in new windows
        response.emailData.forEach(({ unsubscribeLink }) => {
          if (unsubscribeLink) {
            window.open(unsubscribeLink, '_blank');
          }
        });
        
        // Remove unsubscribed items from the list
        itemsWithLinks.forEach(item => item.remove());
        
        // Update stats
        const remainingCount = subscriptionList.querySelectorAll('.subscription-item').length;
        document.getElementById('totalCount').textContent = remainingCount;
        
        // Update storage
        const { subscriptions } = await chrome.storage.local.get('subscriptions');
        const updatedSubscriptions = subscriptions.filter(sub => 
          !itemsWithLinks.some(item => item.dataset.id === sub.id)
        );
        await chrome.storage.local.set({ subscriptions: updatedSubscriptions });
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
  
  // Handle scan button click
  async function handleScan() {
    try {
      scanButton.disabled = true;
      scanButton.textContent = 'Scanning...';
      subscriptionList.innerHTML = '<div class="loading">Scanning your emails...</div>';
      progressContainer.classList.add('active');
      
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
      progressContainer.classList.remove('active');
    }
  }
}); 