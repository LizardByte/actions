# standard imports
import os
import sys

# lib imports
from dotenv import load_dotenv
import requests

# Load the environment variables from the Environment File
load_dotenv()
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))


def facebook_post(
        access_token: str,
        message: str,
        page_id: str,
        url: str = None,
        fail_on_error: str = 'true'
):
    facebook_api_end = f'https://graph.facebook.com/{page_id}/feed'

    facebook_api_data = {
        'message': message,
        'access_token': access_token,
    }
    if url:
        facebook_api_data['link'] = url

    r = requests.post(url=facebook_api_end, json=facebook_api_data)

    result = r.json()

    if 'error' not in result:
        print('Post successful')
    else:
        print('Post error:')
        print(result)
        if fail_on_error.lower() == 'true':
            print('Failing the workflow')
            sys.exit(1)


if __name__ == '__main__':
    facebook_post(
        access_token=os.environ['INPUT_ACCESS_TOKEN'],
        message=os.environ['INPUT_MESSAGE'],
        page_id=os.environ['INPUT_PAGE_ID'],
        url=os.getenv('INPUT_URL', None),
        fail_on_error=os.getenv('INPUT_FAIL_ON_ERROR', 'true')
    )  # pragma: no cover
