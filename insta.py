import sys
import random
import traceback
from instagrapi import Client
from instagrapi.exceptions import (
    LoginRequired, ChallengeRequired, FeedbackRequired,
    PleaseWaitFewMinutes, ClientError, BadPassword
)

ACCOUNTS = [
    {"username": "comp30798", "password": "$UaL3piEgnc#_B&"},
    {"username": "seiyul190720002026", "password": "iyul19072000gmail.com"},
    {"username": "duiyul190720002026", "password": "iyul19072000gmail.com"},
    {"username": "aliniyul190720002026", "password": "iyul333333333!!!"},
    {"username": "iyul19072000", "password": "-z*n@2qk8xTv.w!"},
    {"username": "oydin66612026", "password": "#8bfq3@y9SUCaz2"},
    {"username": "dunyo07082022", "password": "Nm,8ygwN*?&Y6B5"},
]

def get_video_url(instagram_url: str) -> str:
    account = random.choice(ACCOUNTS)
    print(f"DEBUG: {account['username']} bilan login qilinmoqda...", file=sys.stderr)

    cl = Client()

    try:
        cl.login(account["username"], account["password"])
        print(f"DEBUG: Login muvaffaqiyatli!", file=sys.stderr)
    except ChallengeRequired as e:
        print(f"DEBUG_TYPE: ChallengeRequired", file=sys.stderr)
        print(f"DEBUG_DETAIL: {e}", file=sys.stderr)
        print(f"DEBUG_LAST_JSON: {cl.last_json}", file=sys.stderr)
        raise
    except BadPassword as e:
        print(f"DEBUG_TYPE: BadPassword", file=sys.stderr)
        raise
    except PleaseWaitFewMinutes as e:
        print(f"DEBUG_TYPE: PleaseWaitFewMinutes (rate limit)", file=sys.stderr)
        raise
    except FeedbackRequired as e:
        print(f"DEBUG_TYPE: FeedbackRequired", file=sys.stderr)
        print(f"DEBUG_LAST_JSON: {cl.last_json}", file=sys.stderr)
        raise
    except ClientError as e:
        print(f"DEBUG_TYPE: ClientError", file=sys.stderr)
        print(f"DEBUG_LAST_JSON: {getattr(cl, 'last_json', None)}", file=sys.stderr)
        raise
    except Exception as e:
        print(f"DEBUG_TYPE: {type(e).__name__}", file=sys.stderr)
        print(f"DEBUG_LAST_JSON: {getattr(cl, 'last_json', None)}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        raise

    media_pk = cl.media_pk_from_url(instagram_url)
    print(f"DEBUG: media_pk: {media_pk}", file=sys.stderr)

    media_info = cl.media_info(media_pk)
    return str(media_info.video_url)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("ERROR: URL berilmadi", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]

    try:
        video_url = get_video_url(url)
        print(video_url)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
