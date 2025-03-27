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
    displaySubscriptions(subscriptions);
    updateStats(subscriptions);
  }
  
  // Display subscriptions in the list
  function displaySubscriptions(subscriptions) {
    if (!subscriptions || subscriptions.length === 0) {
      subscriptionList.innerHTML = '<div class="loading">No subscriptions found. Click "Scan Emails" to start.</div>';
      return;
    }
    
    subscriptionList.innerHTML = subscriptions.map(sub => `
      <div class="subscription-item" data-id="${sub.id}">
        <input type="checkbox" class="subscription-checkbox">
        <div class="subscription-info">
          <p class="subscription-name">${sub.subject}</p>
          <p class="subscription-category">${sub.from} • ${sub.category}</p>
        </div>
      </div>
    `).join('');
  }
  
  // Update statistics
  function updateStats(subscriptions) {
    const totalCount = document.getElementById('totalCount');
    const newsletterCount = document.getElementById('newsletterCount');
    const socialCount = document.getElementById('socialCount');
    
    totalCount.textContent = subscriptions.length;
    newsletterCount.textContent = subscriptions.filter(s => s.category === 'newsletter').length;
    socialCount.textContent = subscriptions.filter(s => s.category === 'social').length;
  }
  
  // Filter subscriptions based on category and search
  function filterSubscriptions() {
    const category = categoryFilter.value;
    const searchTerm = searchInput.value.toLowerCase();
    
    const items = subscriptionList.querySelectorAll('.subscription-item');
    items.forEach(item => {
      const name = item.querySelector('.subscription-name').textContent.toLowerCase();
      const categoryText = item.querySelector('.subscription-category').textContent.toLowerCase();
      
      const matchesCategory = category === 'all' || categoryText.includes(category);
      const matchesSearch = !searchTerm || name.includes(searchTerm) || categoryText.includes(searchTerm);
      
      item.style.display = matchesCategory && matchesSearch ? 'flex' : 'none';
    });
  }
  
  // Handle unsubscribe button click
  async function handleUnsubscribe() {
    const selectedIds = Array.from(subscriptionList.querySelectorAll('.subscription-checkbox:checked'))
      .map(checkbox => checkbox.closest('.subscription-item').dataset.id);
    
    if (selectedIds.length === 0) {
      showError('Please select subscriptions to unsubscribe from');
      return;
    }
    
    try {
      unsubscribeButton.disabled = true;
      unsubscribeButton.textContent = 'Processing...';
      
      const response = await chrome.runtime.sendMessage({
        action: 'unsubscribe',
        emailIds: selectedIds
      });
      
      if (!response.success) {
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
}); 