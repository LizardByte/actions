# standard imports
from unittest.mock import patch

# local imports
from actions.facebook_post.main import facebook_post


def test_facebook_post_success():
    with patch('requests.post') as mock_post:
        mock_post.return_value.json.return_value = {}

        facebook_post(
            access_token='test_access_token',
            message='test_message',
            page_id='test_page_id',
            url='https://test.url',
            fail_on_error='true'
        )

        mock_post.assert_called_once_with(
            url='https://graph.facebook.com/test_page_id/feed',
            json={
                'message': 'test_message',
                'access_token': 'test_access_token',
                'link': 'https://test.url'
            }
        )


def test_facebook_post_error():
    with patch('requests.post') as mock_post, patch('sys.exit') as mock_exit:
        mock_post.return_value.json.return_value = {'error': 'test_error'}

        facebook_post(
            access_token='test_access_token',
            message='test_message',
            page_id='test_page_id',
            url='https://test.url',
            fail_on_error='true'
        )

        mock_post.assert_called_once_with(
            url='https://graph.facebook.com/test_page_id/feed',
            json={
                'message': 'test_message',
                'access_token': 'test_access_token',
                'link': 'https://test.url'
            }
        )
        mock_exit.assert_called_once_with(1)


def test_facebook_post_error_no_fail():
    with patch('requests.post') as mock_post, patch('sys.exit') as mock_exit:
        mock_post.return_value.json.return_value = {'error': 'test_error'}

        facebook_post(
            access_token='test_access_token',
            message='test_message',
            page_id='test_page_id',
            url='https://test.url',
            fail_on_error='false'
        )
        mock_post.assert_called_once_with(
            url='https://graph.facebook.com/test_page_id/feed',
            json={
                'message': 'test_message',
                'access_token': 'test_access_token',
                'link': 'https://test.url'
            }
        )
        mock_exit.assert_not_called()
