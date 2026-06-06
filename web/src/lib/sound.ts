const NOTIFY_URL = 'https://www.myinstants.com/media/sounds/applepay.mp3'

export function playNotifySound() {
  if (localStorage.getItem('tos-sound-enabled') === 'false') return
  new Audio(NOTIFY_URL).play().catch(() => {})
}
