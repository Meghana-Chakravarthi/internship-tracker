pipeline {
    agent any

    environment {
        IMAGE_NAME     = 'internship-tracker'
        CONTAINER_NAME = 'internship-tracker'
        DATA_VOLUME    = 'internship-tracker-data'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('Build Docker Image') {
            steps {
                sh 'docker build -t ${IMAGE_NAME}:${BUILD_NUMBER} .'
            }
        }

        stage('Deploy') {
            steps {
                withCredentials([string(credentialsId: 'internship-tracker-session-secret', variable: 'SESSION_SECRET')]) {
                    sh '''
                        docker volume create ${DATA_VOLUME}
                        docker stop ${CONTAINER_NAME} || true
                        docker rm ${CONTAINER_NAME} || true
                        docker run -d --name ${CONTAINER_NAME} \
                            -e NODE_ENV=production \
                            -e SESSION_SECRET="$SESSION_SECRET" \
                            -v ${DATA_VOLUME}:/app/data \
                            -p 3000:3000 \
                            ${IMAGE_NAME}:${BUILD_NUMBER}
                    '''
                }
            }
        }

        stage('Verify Deployment') {
            steps {
                sh '''
                    for i in 1 2 3 4 5 6 7 8 9 10; do
                        if curl -fsS http://localhost:3000/api/health; then
                            echo ""
                            echo "Health check passed"
                            exit 0
                        fi
                        echo "Waiting for application... attempt $i"
                        sleep 3
                    done
                    echo "Health check FAILED"
                    docker logs ${CONTAINER_NAME}
                    exit 1
                '''
            }
        }
    }

    post {
        success {
            echo "Deployed internship-tracker:${BUILD_NUMBER} at http://localhost:3000"
        }
        failure {
            echo 'Pipeline failed. Check the stage logs above.'
        }
    }
}
