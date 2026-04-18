#!/bin/bash
# Run this from a machine with network access to the pre-alpha endpoints.
# Discovers the real gRPC service definitions and saves them locally.
#
# Requires: grpcurl (https://github.com/fullstorydev/grpcurl)
#   brew install grpcurl       # macOS
#   go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest

ENCRYPT_ENDPOINT="pre-alpha-dev-1.encrypt.ika-network.net:443"
IKA_ENDPOINT="pre-alpha-dev-1.ika.ika-network.net:443"

echo "=== Discovering Encrypt services ==="
grpcurl "$ENCRYPT_ENDPOINT" list
echo ""
echo "=== Encrypt service methods ==="
grpcurl "$ENCRYPT_ENDPOINT" list $(grpcurl "$ENCRYPT_ENDPOINT" list | head -1)
echo ""
echo "=== Encrypt proto descriptor ==="
grpcurl -proto-out-dir ./discovered "$ENCRYPT_ENDPOINT" describe

echo ""
echo "=== Discovering Ika services ==="
grpcurl "$IKA_ENDPOINT" list
echo ""
echo "=== Ika service methods ==="
grpcurl "$IKA_ENDPOINT" list $(grpcurl "$IKA_ENDPOINT" list | head -1)
echo ""
echo "=== Ika proto descriptor ==="
grpcurl -proto-out-dir ./discovered "$IKA_ENDPOINT" describe
