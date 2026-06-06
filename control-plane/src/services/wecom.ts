const WECOM_CORP_ID = process.env.WECOM_CORP_ID || ''
const WECOM_CORP_SECRET = process.env.WECOM_CORP_SECRET || ''
const WECOM_AGENT_ID = process.env.WECOM_AGENT_ID || ''

let accessToken: string | null = null
let tokenExpiresAt = 0

export function isWeComEnabled(): boolean {
  return !!(WECOM_CORP_ID && WECOM_CORP_SECRET && WECOM_AGENT_ID)
}

/** Get or refresh the corp access_token (cached, 2h TTL) */
async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiresAt - 60_000) {
    return accessToken
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${WECOM_CORP_ID}&corpsecret=${WECOM_CORP_SECRET}`
  const res = await fetch(url)
  const data = (await res.json()) as {
    errcode: number
    errmsg: string
    access_token: string
    expires_in: number
  }

  if (data.errcode !== 0) {
    throw new Error(`WeChat Work gettoken failed: ${data.errmsg}`)
  }

  accessToken = data.access_token
  tokenExpiresAt = Date.now() + data.expires_in * 1000
  return accessToken
}

/** Build the QR scan authorization URL */
export function getAuthorizeUrl(redirectUri: string, state: string): string {
  return `https://login.work.weixin.qq.com/wwlogin/sso/login?login_type=CorpApp&appid=${WECOM_CORP_ID}&agentid=${WECOM_AGENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
}

/** Exchange an auth code for the user's corp userid */
export async function getUserByCode(code: string): Promise<{ userid: string }> {
  const token = await getAccessToken()
  const url = `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${token}&code=${code}`
  const res = await fetch(url)
  const data = (await res.json()) as { errcode: number; errmsg: string; userid?: string }

  if (data.errcode !== 0 || !data.userid) {
    throw new Error(`WeChat Work getuserinfo failed: ${data.errmsg}`)
  }

  return { userid: data.userid }
}

/** Get user profile by userid */
export async function getUserInfo(userid: string): Promise<{
  userid: string
  name: string
  avatar: string
  email: string
}> {
  const token = await getAccessToken()
  const url = `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${token}&userid=${userid}`
  const res = await fetch(url)
  const data = (await res.json()) as {
    errcode: number
    errmsg: string
    userid: string
    name: string
    avatar: string
    email: string
  }

  if (data.errcode !== 0) {
    throw new Error(`WeChat Work user/get failed: ${data.errmsg}`)
  }

  return {
    userid: data.userid,
    name: data.name,
    avatar: data.avatar || '',
    email: data.email || '',
  }
}

/** Send an application message to a user */
// biome-ignore lint/correctness/noUnusedVariables: scaffolding for future user-targeted notifications
async function sendMessage(userid: string, content: string): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: userid,
        msgtype: 'markdown',
        agentid: Number.parseInt(WECOM_AGENT_ID, 10),
        markdown: { content },
      }),
    },
  )
  const data = (await res.json()) as { errcode: number; errmsg: string }

  if (data.errcode !== 0) {
    throw new Error(`WeChat Work message/send failed: ${data.errmsg}`)
  }
}
