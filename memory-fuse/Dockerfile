FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/memory-fuse ./cmd/memory-fuse

FROM alpine:3.20
RUN apk add --no-cache fuse3 ca-certificates
COPY --from=build /out/memory-fuse /usr/local/bin/memory-fuse
ENTRYPOINT ["/usr/local/bin/memory-fuse"]
