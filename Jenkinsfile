properties([
  pipelineTriggers([
    githubPush()
  ])
])

pipeline {
  agent any

  options {
    skipDefaultCheckout()
  }

  environment {
    WORKSPACE_DIR = "${env.WORKSPACE}"

    // Config
    IMAGE_NAME = 'fb-watchtower'
    CONTAINER_NAME = 'fb-watchtower'
    ENV_FILE = '/opt/env/fb-watchtower.env'
    SLACK_CHANNEL = '#deployments'
  }

  stages {
    stage('Init') {
      steps {
        script {
          env.DATETIME = sh(script: "TZ='Asia/Ho_Chi_Minh' date +%Y%m%d-%H%M%S", returnStdout: true).trim()
          env.HUMAN_DATETIME = sh(script: "TZ='Asia/Ho_Chi_Minh' date +'%d/%m/%Y %H:%M'", returnStdout: true).trim()
        }
      }
    }

    stage('Clone Source Code') {
      steps {
        checkout scm
      }
    }

    stage('Build Image') {
      steps {
        sh """
          echo "Building Docker image..."
          docker build -t $IMAGE_NAME:$DATETIME -t $IMAGE_NAME:latest .
        """
      }
    }

    stage('Deploy Container') {
      steps {
        sh """
          echo "Deploying Container..."
          docker stop "$CONTAINER_NAME" || true
          docker rm "$CONTAINER_NAME" || true

          ENV_OPTS=""
          if [ -f "\$ENV_FILE" ]; then
             ENV_OPTS="--env-file \$ENV_FILE"
          fi

          docker run -d \\
            --name "$CONTAINER_NAME" \\
            \$ENV_OPTS \\
            --restart unless-stopped \\
            "$IMAGE_NAME:latest"
        """
      }
    }
  }

  post {
    success {
      slackSend(
        channel: SLACK_CHANNEL,
        color: 'good',
        tokenCredentialId: 'slack-token',
        message: """:rocket: *[fb-watchtower]* Deployment *Succeeded!*
━━━━━━━━━━━━━━━━━━━━━━━
• ✅ *Status:* SUCCESS
• 🕘 *Time:* _${env.HUMAN_DATETIME}_
• 🔗 *Build:* <${env.BUILD_URL}|View on Jenkins>
━━━━━━━━━━━━━━━━━━━━━━━"""
      )
    }

    failure {
      slackSend(
        channel: SLACK_CHANNEL,
        color: 'danger',
        tokenCredentialId: 'slack-token',
        message: """:fire: *[fb-watchtower]* Deployment *Failed!*
━━━━━━━━━━━━━━━━━━━━━━━
• ❌ *Status:* FAILED
• 🕘 *Time:* _${env.HUMAN_DATETIME}_
• 🔗 *Build:* <${env.BUILD_URL}|View on Jenkins>
━━━━━━━━━━━━━━━━━━━━━━━"""
      )
    }
  }
}
