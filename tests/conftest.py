# standard imports
import os

# lib imports
try:
    from dotenv import load_dotenv  # this will fail for setup_python action
except ImportError:
    pass
else:
    load_dotenv()

    os.environ['GITHUB_ACTION_PATH'] = os.path.join(os.getcwd(), 'build', 'action_path')
    os.environ['GITHUB_OUTPUT'] = os.path.join(os.getcwd(), 'build', 'github_output.md')
    os.environ['GITHUB_REPOSITORY'] = 'LizardByte/actions'
    os.environ['GITHUB_STEP_SUMMARY'] = os.path.join(os.getcwd(), 'build', 'github_step_summary.md')
    os.environ['GITHUB_WORKSPACE'] = os.path.join(os.getcwd(), 'build', 'workspace')
