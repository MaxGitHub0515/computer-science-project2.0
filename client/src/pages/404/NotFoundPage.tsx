import React from "react";

const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <h1 className="text-4xl font-bold mb-4">404 - Not Found</h1>
      <p className="text-lg opacity-80">
        The page you were looking for doesn&apos;t exist.
      </p>
    </div>
  );
};

export default NotFoundPage;
