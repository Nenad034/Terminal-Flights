FROM golang:1.23-alpine AS build
WORKDIR /app
COPY go.mod ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN go build -o search-fanout .

FROM alpine:3.20
WORKDIR /app
COPY --from=build /app/search-fanout .
EXPOSE 4003
CMD ["./search-fanout"]
